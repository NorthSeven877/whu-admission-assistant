
"""Regression coverage for the admissions turn protocol and SQL tool."""
import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from dbgpt_app.openapi.api_v1 import whu_react as react


class AdmissionReactTests(unittest.IsolatedAsyncioTestCase):
    async def test_uses_tool_observations_in_next_model_request(self):
        actions = [
            {"summary": "查招生数据", "calls": [{"tool": "sql_query", "input":
                "SELECT min_score FROM whu_school_summary WHERE year = '2024'"}]},
            {"summary": "补查政策", "calls": [{"tool": "graph_search", "input": "2025 招生章程"}]},
            {"summary": "整理结果", "answer": "已查到 641 分和 2025 招生章程。"},
        ]
        reasoning = ["第一轮原生推理", "第二轮原生推理", None]
        responses = [
            (json.dumps(action, ensure_ascii=False), "stop", thought)
            for action, thought in zip(actions, reasoning)
        ]
        request = react.AdmissionRequest(question="今年政策与历史分数", debug=True)
        sent = []

        async def model(_client, messages, _timeout):
            sent.append(list(messages))
            return responses.pop(0)

        sql_result = {"columns": ["min_score"], "rows": [[641]]}
        graph_result = {"documents": [{"title": "2025 招生章程"}]}
        with patch.object(react, "_model", side_effect=model), patch.object(
            react, "_run_tool", new=AsyncMock(side_effect=[sql_result, graph_result]),
        ):
            events = [json.loads(frame[6:]) async for frame in react._loop(request)]

        model_starts = [event["messages"] for event in events if event["type"] == "model.start"]
        self.assertEqual(model_starts, sent)
        self.assertIn("641", sent[1][-1]["content"])
        self.assertIn("2025 招生章程", sent[2][-1]["content"])
        model_results = [event for event in events if event["type"] == "model.result"]
        self.assertEqual([event.get("reasoning") for event in model_results], reasoning)
        self.assertNotIn("reasoning", model_results[-1])
        self.assertNotIn("原生推理", json.dumps(sent, ensure_ascii=False))
        self.assertEqual([event["result"] for event in events if event["type"] == "tool.result"],
                         [sql_result, graph_result])
        self.assertEqual([event["type"] for event in events[-2:]], ["final", "done"])

    async def test_regular_chat_has_no_model_payloads(self):
        request = react.AdmissionRequest(question="你好")
        responses = [
            ('{"summary":"用检索核对政策","calls":[{"tool":"graph_search","input":"转专业"}]}',
             "stop", "第一轮原生推理"),
            ('{"answer":"你好"}', "stop", "第二轮原生推理"),
        ]
        document = {"title": "转专业政策", "url": "https://example.test/policy", "text": "资料正文"}
        with patch.object(react, "_model", new=AsyncMock(side_effect=responses)), patch.object(
            react, "_run_tool", new=AsyncMock(return_value={"documents": [document]}),
        ) as tool:
            events = [json.loads(frame[6:]) async for frame in react._loop(request)]
        tool.assert_awaited_once()
        self.assertEqual([event["type"] for event in events],
                         ["start", "model.start", "model.result", "model.start", "model.result", "final", "done"])
        self.assertFalse(any({"messages", "output", "reasoning"} & event.keys() for event in events))
        self.assertEqual(events[-2]["sources"][0]["title"], document["title"])
        self.assertEqual(events[-2]["sources"][0]["url"], document["url"])
        self.assertGreaterEqual(events[-2]["seconds"], 0)

    async def test_model_reads_native_reasoning_without_changing_public_json(self):
        action = '{"summary":"完成","answer":"你好"}'
        cases = [
            ({"reasoning": "甲\n乙", "reasoning_content": "备用"}, "甲\n乙"),
            ({"reasoning": " ", "reasoning_content": "备用"}, "备用"),
            ({"reasoning": None, "reasoning_content": ["非文本"]}, None),
            ({}, None),
        ]
        with patch.dict("os.environ", {"WHU_QWEN_API_BASE": "https://example.test", "WHU_QWEN_API_KEY": "mock"}):
            for fields, expected in cases:
                with self.subTest(fields=fields):
                    response = {"choices": [{"message": {
                        "content": "<think>旧式推理标记</think>" + action, **fields,
                    }, "finish_reason": "stop"}]}
                    transport = httpx.MockTransport(lambda _: httpx.Response(200, json=response))
                    async with httpx.AsyncClient(transport=transport) as client:
                        self.assertEqual(await react._model(client, [], 3), (action, "stop", expected))

    def test_sql_limits_and_table_permissions(self):
        self.assertIn("LIMIT 101", react._prepare_sql("SELECT min_score FROM whu_school_summary"))
        for query in (
            "DELETE FROM whu_school_summary",
            "SELECT * FROM pg_catalog.pg_roles",
            "SELECT * FROM whu_school_summary; SELECT 1",
        ):
            with self.subTest(query=query), self.assertRaises(ValueError):
                react._prepare_sql(query)
