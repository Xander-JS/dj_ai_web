import unittest
from unittest.mock import AsyncMock, Mock, patch

from yt_dlp import parse_options

from app.services import extractor


class ExtractorTests(unittest.IsolatedAsyncioTestCase):
    async def test_inspection_and_download_use_same_youtube_runtime_and_clients(self):
        with patch.object(extractor, "YoutubeDL") as ydl:
            ydl.return_value.__enter__.return_value.extract_info.return_value = {
                "title": "Track", "duration": 120,
            }
            video = extractor.inspect_video("https://www.youtube.com/watch?v=Pt0gH4H_NQw")
            inspection = ydl.call_args.args[0]

        downloader = Mock(returncode=0, wait=AsyncMock())
        encoder = Mock(returncode=0, wait=AsyncMock())
        encoder.stdout.read = AsyncMock(side_effect=[b"mp3", b""])
        with patch.object(extractor.asyncio, "create_subprocess_exec", new_callable=AsyncMock) as spawn:
            spawn.side_effect = [downloader, encoder]
            stream = await extractor.open_audio_stream(video)
            self.assertEqual([chunk async for chunk in stream], [b"mp3"])
            args = list(spawn.call_args_list[0].args[3:])

        download = parse_options(args).ydl_opts
        self.assertIn("--ignore-config", args)
        for options in (inspection, download):
            self.assertIn("node", options["js_runtimes"])
            self.assertFalse(options.get("extractor_args", {}).get("youtube", {}).get("player_client"))
        downloader.wait.assert_awaited_once()
        encoder.wait.assert_awaited_once()

    async def test_duration_limit_still_rejects_long_videos(self):
        with patch.object(extractor, "YoutubeDL") as ydl:
            ydl.return_value.__enter__.return_value.extract_info.return_value = {
                "duration": extractor.config.MAX_DURATION_SECONDS + 1,
            }
            with self.assertRaisesRegex(extractor.ExtractionError, "supera el límite"):
                extractor.inspect_video("https://www.youtube.com/watch?v=Pt0gH4H_NQw")
