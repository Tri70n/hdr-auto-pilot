import asyncio
import io
import json
import os
import runpy
import sys
import time
import unittest
import urllib.parse
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

    def test_resolve_sync_invokes_the_isolated_pcgw_helper(self):
        plugin = self.make_plugin({})
        resolved = {
            "appid": "123",
            "game": "Helper Game",
            "page": "Helper_Game",
            "hdr": "true",
        }
        completed = SimpleNamespace(
            returncode=0,
            stdout=json.dumps(resolved),
            stderr="",
        )
        root = Path(__file__).resolve().parents[1]
        helper = root / "pcgw_helper.py"
        sanitized_variables = (
            "LD_LIBRARY_PATH",
            "LD_PRELOAD",
            "LD_AUDIT",
            "PYTHONHOME",
            "PYTHONPATH",
            "PYTHONEXECUTABLE",
            "PYTHONUSERBASE",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
        )
        inherited_environment = {
            variable: "must-not-reach-helper" for variable in sanitized_variables
        }
        inherited_environment["HOME"] = "/home/test-user"

        with patch.dict(os.environ, inherited_environment), patch(
            "shutil.which", return_value="/usr/bin/python3"
        ) as which, patch("subprocess.run", return_value=completed) as subprocess_run, patch(
            "urllib.request.urlopen"
        ) as urlopen:
            result = plugin._resolve_sync(" 123 ")

        self.assertEqual(result, resolved)
        which.assert_called_once_with(
            "python3",
            path="/usr/local/bin:/usr/bin:/bin",
        )
        subprocess_run.assert_called_once()
        command = subprocess_run.call_args.args[0]
        options = subprocess_run.call_args.kwargs
        self.assertEqual(command, ["/usr/bin/python3", "-I", str(helper), "123"])
        self.assertEqual(options["cwd"], str(root))
        self.assertEqual(options["env"]["PATH"], "/usr/local/bin:/usr/bin:/bin")
        self.assertEqual(options["env"]["HOME"], "/home/test-user")
        for variable in sanitized_variables:
            self.assertNotIn(variable, options["env"])
        urlopen.assert_not_called()


class CuratorPriorityTests(unittest.TestCase):
    def make_plugin(self):
        return backend["Plugin"]()

    def test_curator_only_replaces_pcgw_when_it_adds_hdr_information(self):
        cases = (
            ("hackable", "workaround", "hackable", "PCGamingWiki"),
            ("false", "workaround", "hackable", "Steam HDR Curator"),
            (None, "workaround", "hackable", "Steam HDR Curator"),
            ("false", "native", "true", "Steam HDR Curator"),
            (None, "native", "true", "Steam HDR Curator"),
            ("hackable", "native", "true", "Steam HDR Curator"),
        )

        for pcgw_hdr, curator_status, expected_hdr, expected_source in cases:
            with self.subTest(pcgw_hdr=pcgw_hdr, curator_status=curator_status):
                plugin = self.make_plugin()
                entry = {
                    "status": curator_status,
                    "description": "Curator detail",
                }
                with patch.object(
                    plugin,
                    "_get_steam_hdr_curator_entries_sync",
                    return_value={"391220": entry},
                ) as curator:
                    pcgw_result = {"appid": "391220"}
                    if pcgw_hdr is not None:
                        pcgw_result["hdr"] = pcgw_hdr
                    result = plugin._apply_steam_hdr_curator_fallback_sync(pcgw_result)

                self.assertEqual(result["hdr"], expected_hdr)
                self.assertEqual(result["source"], expected_source)
                curator.assert_called_once_with()

    def test_native_pcgw_result_skips_curator_lookup(self):
        plugin = self.make_plugin()
        with patch.object(
            plugin,
            "_get_steam_hdr_curator_entries_sync",
        ) as curator:
            result = plugin._apply_steam_hdr_curator_fallback_sync(
                {"appid": "391220", "hdr": "true"}
            )

        self.assertEqual(result["hdr"], "true")
        self.assertEqual(result["source"], "PCGamingWiki")
        curator.assert_not_called()


class CuratorPaginationTests(unittest.TestCase):
    def make_plugin(self):
        plugin = backend["Plugin"]()
        plugin.steam_hdr_curator_cache = {}
        return plugin

    def response(self, start, total_count, recommendations):
        results_html = "".join(
            f'<a href="https://store.steampowered.com/app/{appid}/Game/" '
            'class="recommendation_link">'
            f'<div class="recommendation_desc">{description}</div>'
            for appid, description in recommendations
        )
        return io.StringIO(json.dumps({
            "start": str(start),
            "pagesize": "100",
            "total_count": total_count,
            "results_html": results_html,
        }))

    def requested_starts(self, urlopen):
        return [
            int(urllib.parse.parse_qs(
                urllib.parse.urlparse(call.args[0].full_url).query
            )["start"][0])
            for call in urlopen.call_args_list
        ]

    def test_fetch_merges_all_curator_pages(self):
        plugin = self.make_plugin()
        responses = (
            self.response(0, 201, (("1", "Native support"),)),
            self.response(100, 201, (("2", "Workaround"),)),
            self.response(200, 201, (("3", "Windows Auto HDR"),)),
        )
        with patch("urllib.request.urlopen", side_effect=responses) as urlopen:
            entries = plugin._fetch_steam_hdr_curator_sync()

        self.assertEqual(set(entries), {"1", "2", "3"})
        self.assertEqual(self.requested_starts(urlopen), [0, 100, 200])

    def test_fetch_stops_at_exact_total_without_an_extra_request(self):
        plugin = self.make_plugin()
        responses = (
            self.response(0, 200, (("1", "Native support"),)),
            self.response(100, 200, (("2", "Workaround"),)),
        )
        with patch("urllib.request.urlopen", side_effect=responses) as urlopen:
            entries = plugin._fetch_steam_hdr_curator_sync()

        self.assertEqual(set(entries), {"1", "2"})
        self.assertEqual(self.requested_starts(urlopen), [0, 100])

    def test_later_page_failure_does_not_replace_the_existing_cache(self):
        plugin = self.make_plugin()
        previous_cache = {
            "timestamp": 0,
            "entries": {"old": {"status": "native"}},
        }
        plugin.steam_hdr_curator_cache = previous_cache
        responses = (
            self.response(0, 101, (("1", "Native support"),)),
            OSError("second page failed"),
        )
        with patch("urllib.request.urlopen", side_effect=responses), patch.object(
            plugin, "_save_steam_hdr_curator_cache"
        ) as save:
            with self.assertRaisesRegex(OSError, "second page failed"):
                plugin._get_steam_hdr_curator_entries_sync()

        self.assertEqual(plugin.steam_hdr_curator_cache, previous_cache)
        save.assert_not_called()


class HdrLookupDeduplicationTests(unittest.IsolatedAsyncioTestCase):
    def make_plugin(self):
        plugin = backend["Plugin"]()
        plugin.cache = {}
        return plugin

    async def test_concurrent_lookup_is_shared_and_later_lookup_can_run(self):
        plugin = self.make_plugin()
        resolved = {
            "appid": "391220",
            "game": "Rise of the Tomb Raider",
            "page": "Rise_of_the_Tomb_Raider",
            "hdr": "hackable",
        }
        started = asyncio.Event()
        release = asyncio.Event()
        resolve_calls = 0

        with patch.object(plugin, "_resolve_sync") as resolve, patch.object(
            plugin,
            "_apply_steam_hdr_curator_fallback_sync",
            side_effect=lambda result: result,
        ) as curator, patch.object(plugin, "_save_cache"), patch(
            "asyncio.to_thread"
        ) as to_thread:
            async def run_in_thread(function, *args):
                nonlocal resolve_calls
                if function is resolve:
                    resolve_calls += 1
                    started.set()
                    await release.wait()
                    return dict(resolved)
                return function(*args)

            to_thread.side_effect = run_in_thread
            first = asyncio.create_task(plugin.get_hdr_info("391220"))
            await started.wait()
            second = asyncio.create_task(plugin.get_hdr_info("391220"))
            await asyncio.sleep(0)
            release.set()
            first_result, second_result = await asyncio.gather(first, second)

            plugin.cache = {}
            later_result = await plugin.get_hdr_info("391220")

        self.assertEqual(first_result, second_result)
        self.assertEqual(first_result["hdr"], "hackable")
        self.assertFalse(first_result["cached"])
        self.assertEqual(later_result["hdr"], "hackable")
        self.assertEqual(resolve_calls, 2)
        self.assertEqual(curator.call_count, 2)

    async def test_failed_shared_lookup_is_removed_for_retry(self):
        plugin = self.make_plugin()
        resolved = {
            "appid": "123",
            "game": "Retry Game",
            "page": "Retry_Game",
            "hdr": "true",
        }
        started = asyncio.Event()
        release = asyncio.Event()
        resolve_calls = 0
        fail = True

        with patch.object(plugin, "_resolve_sync") as resolve, patch.object(
            plugin,
            "_apply_steam_hdr_curator_fallback_sync",
            side_effect=lambda result: result,
        ), patch.object(plugin, "_save_cache"), patch(
            "asyncio.to_thread"
        ) as to_thread:
            async def run_in_thread(function, *args):
                nonlocal resolve_calls
                if function is resolve:
                    resolve_calls += 1
                    started.set()
                    await release.wait()
                    if fail:
                        raise OSError("lookup failed")
                    return dict(resolved)
                return function(*args)

            to_thread.side_effect = run_in_thread
            first = asyncio.create_task(plugin.get_hdr_info("123"))
            await started.wait()
            second = asyncio.create_task(plugin.get_hdr_info("123"))
            await asyncio.sleep(0)
            release.set()
            failures = await asyncio.gather(first, second, return_exceptions=True)

            fail = False
            retry = await plugin.get_hdr_info("123")

        self.assertEqual(len(failures), 2)
        self.assertTrue(all(isinstance(error, OSError) for error in failures))
        self.assertEqual(retry["hdr"], "true")
        self.assertEqual(resolve_calls, 2)


if __name__ == "__main__":
    unittest.main()
