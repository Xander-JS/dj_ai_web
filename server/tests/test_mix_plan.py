import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
from app import mix_plan as m

BODY = {'reference': {'id': 'a', 'bpm': 120}, 'candidates': [{'id': 'b', 'bpm': 120}]}
PLAN = {'trackId': 'b', 'enterAfterBeats': 32, 'transitionBeats': 16, 'adjustments': [{'beat': 0, 'control': 'mid', 'value': 45}]}
ENV = {'SUPABASE_URL': 'https://example.supabase.co', 'SUPABASE_ANON_KEY': 'public', 'DEEPSEEK_API_KEY': 'secret'}

class Response:
    status_code = 200
    def __init__(self, body): self.body = body
    def json(self): return self.body

class Request:
    headers = {'authorization': 'Bearer token'}
    async def stream(self): yield json.dumps(BODY).encode()
    async def is_disconnected(self): return False

class Tests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        m.usage.clear(); m.active.clear()
        self.client = AsyncMock()
        self.client.get.return_value = Response({'id': 'user'})
        self.client.post.return_value = Response({'choices': [{'message': {'content': json.dumps(PLAN)}}]})
        self.client.__aenter__.return_value = self.client
        self.env = patch.dict('os.environ', ENV); self.env.start()
        self.http = patch.object(m.httpx, 'AsyncClient', return_value=self.client); self.http.start()
        self.addCleanup(self.env.stop); self.addCleanup(self.http.stop)

    async def test_valid_plan_and_rate_limit(self):
        result = await m.mix_plan(Request())
        self.assertEqual(result['plan']['trackId'], 'b')
        with self.assertRaises(HTTPException) as error: await m.mix_plan(Request())
        self.assertEqual(error.exception.status_code, 429)
        self.assertEqual(self.client.post.await_count, 1)
        self.assertFalse(m.active)

    async def test_session_required_before_spending(self):
        request = Request(); request.headers = {}
        with self.assertRaises(HTTPException) as error: await m.mix_plan(request)
        self.assertEqual(error.exception.status_code, 401)
        self.client.post.assert_not_awaited()

    async def test_cue_validated_against_target_deck(self):
        context = {'position': 0, 'duration': 120, 'playbackRate': 1, 'crossfader': 0,
                   'hotCues': [1], 'downbeatConfirmed': False, 'lead': 'A',
                   'decks': [{'deck': 'B', 'trackId': 'b', 'hotCues': [6], 'downbeatConfirmed': True}]}
        plan = {**PLAN, 'adjustments': [{'beat': 4, 'control': 'hotCue', 'value': 6, 'deck': 'B'}]}
        self.client.post.return_value = Response({'choices': [{'message': {'content': json.dumps(plan)}}]})
        result = await m.generate(m.Input.model_validate({**BODY, 'context': context}), 'Bearer token')
        self.assertEqual(result.adjustments[0].deck, 'B')
        m.usage.clear()
        plan['adjustments'][0]['value'] = 1
        self.client.post.return_value = Response({'choices': [{'message': {'content': json.dumps(plan)}}]})
        with self.assertRaises(ValueError):
            await m.generate(m.Input.model_validate({**BODY, 'context': context}), 'Bearer token')

    async def test_invalid_session(self):
        self.client.get.return_value.status_code = 401
        with self.assertRaises(HTTPException): await m.mix_plan(Request())
        self.client.post.assert_not_awaited()

    async def test_unknown_track_rejected(self):
        self.client.post.return_value = Response({'choices': [{'message': {'content': json.dumps({**PLAN, 'trackId': 'foreign'})}}]})
        with self.assertRaises(HTTPException) as error: await m.mix_plan(Request())
        self.assertEqual(error.exception.status_code, 502)
        self.assertFalse(m.active)

    async def test_disconnect_cancels_provider(self):
        started = asyncio.Event(); cancelled = asyncio.Event()
        async def slow(*args, **kwargs):
            started.set()
            try: await asyncio.Future()
            finally: cancelled.set()
        self.client.post.side_effect = slow
        request = Request()
        async def disconnected(): return started.is_set()
        request.is_disconnected = disconnected
        with self.assertRaises(HTTPException) as error: await m.mix_plan(request)
        self.assertEqual(error.exception.status_code, 499)
        self.assertTrue(cancelled.is_set()); self.assertFalse(m.active)

    async def test_invalid_input_does_not_call_provider(self):
        request = Request()
        async def stream(): yield json.dumps({**BODY, 'audio': 'forbidden'}).encode()
        request.stream = stream
        with self.assertRaises(HTTPException) as error: await m.mix_plan(request)
        self.assertEqual(error.exception.status_code, 400)
        self.client.post.assert_not_awaited()

if __name__ == '__main__': unittest.main()
