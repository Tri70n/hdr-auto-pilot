import runpy
import sys
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


with patch.dict(sys.modules, {"decky": SimpleNamespace(logger=Mock())}):
    backend = runpy.run_path(str(Path(__file__).resolve().parents[1] / "main.py"))


class LaunchCacheTests(unittest.IsolatedAsyncioTestCase):
    def make_plugin(self, cache):
        plugin = backend["Plugin"]()
        plugin.cache = cache
        return plugin

    def entry(self, result, age=0):
        return {
            "timestamp": time.time() - age,
            "result": result,
        }

    async def test_returns_decorated_valid_persistent_hit_without_network(self):
        cached = {
            "appid": "123",
            "game": "Cached HDR Game",
            "page": "Cached_HDR_Game",
            "hdr": "true",
            "source": "PCGamingWiki",
        }
        plugin = self.make_plugin({"123": self.entry(cached)})
        with patch.object(plugin, "_resolve_sync") as resolve, patch.object(
            plugin, "_apply_steam_hdr_curator_fallback_sync"
        ) as curator, patch("urllib.request.urlopen") as urlopen, patch(
            "subprocess.run"
        ) as subprocess_run:
            result = await plugin.get_cached_hdr_info(" 123 ")
        self.assertEqual(result, {
            **cached,
            "cached": True,
            "automatic_action": "enable",
        })
        resolve.assert_not_called()
        curator.assert_not_called()
        urlopen.assert_not_called()
        subprocess_run.assert_not_called()

    async def test_returns_none_for_missing_expired_or_malformed_entries(self):
        max_age = backend["CACHE_MAX_AGE"]
        cases = {
            "missing": {},
            "expired": {"123": self.entry({"hdr": "true"}, max_age + 1)},
            "malformed_entry": {"123": "bad"},
            "malformed_result": {"123": self.entry("bad")},
        }
        for name, cache in cases.items():
            with self.subTest(name=name):
                plugin = self.make_plugin(cache)
                with patch.object(plugin, "_resolve_sync") as resolve, patch.object(
                    plugin, "_apply_steam_hdr_curator_fallback_sync"
                ) as curator:
                    self.assertIsNone(await plugin.get_cached_hdr_info("123"))
                resolve.assert_not_called()
                curator.assert_not_called()

    async def test_cache_only_lookup_does_not_mutate_cache(self):
        cached = {"appid": "123", "hdr": "false"}
        entry = self.entry(cached)
        plugin = self.make_plugin({"123": entry})
        before = {"123": {"timestamp": entry["timestamp"], "result": dict(cached)}}
        result = await plugin.get_cached_hdr_info("123")
        self.assertEqual(result["automatic_action"], "disable")
        self.assertEqual(plugin.cache, before)

    async def test_non_native_and_missing_hdr_values_remain_sdr(self):
        for hdr in ("hackable", "missing", None):
            with self.subTest(hdr=hdr):
                result_data = {"appid": "123"}
                if hdr is not None:
                    result_data["hdr"] = hdr
                plugin = self.make_plugin({"123": self.entry(result_data)})
                result = await plugin.get_cached_hdr_info("123")
                self.assertEqual(result["automatic_action"], "disable")


if __name__ == "__main__":
    unittest.main()
