import runpy
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


# Load the real backend with only Decky's host module replaced. All settings
# writes are mocked, so these regression tests never write plugin/user files.
with patch.dict(sys.modules, {"decky": SimpleNamespace(logger=Mock())}):
    backend = runpy.run_path(str(Path(__file__).resolve().parents[1] / "main.py"))


class AutoHdrToggleTests(unittest.IsolatedAsyncioTestCase):
    def make_plugin(self, enabled):
        plugin = backend["Plugin"]()
        plugin.settings = {
            **backend["DEFAULT_SETTINGS"],
            "auto_hdr_enabled": enabled,
        }
        return plugin

    async def test_failed_save_restores_backend_setting(self):
        for initial in (False, True):
            with self.subTest(initial=initial):
                plugin = self.make_plugin(initial)
                before = await plugin.get_settings()
                with patch.object(plugin, "_save_settings", side_effect=OSError("disk full")):
                    with self.assertRaisesRegex(OSError, "disk full"):
                        await plugin.set_auto_hdr_enabled(not initial)
                self.assertEqual(await plugin.get_settings(), before)

    async def test_other_settings_cannot_later_persist_rejected_auto_hdr_value(self):
        for initial in (False, True):
            with self.subTest(initial=initial):
                plugin = self.make_plugin(initial)
                with patch.object(plugin, "_save_settings", side_effect=OSError("disk full")):
                    with self.assertRaises(OSError):
                        await plugin.set_auto_hdr_enabled(not initial)

                snapshots = []
                with patch.object(plugin, "_save_settings", side_effect=lambda: snapshots.append(dict(plugin.settings))):
                    result = await plugin.set_mini_badges_enabled(False)
                self.assertEqual(result["auto_hdr_enabled"], initial)
                self.assertEqual(snapshots[0]["auto_hdr_enabled"], initial)
                self.assertFalse(snapshots[0]["mini_badges_enabled"])

    async def test_successful_toggle_saves_and_returns_new_value(self):
        for initial in (False, True):
            with self.subTest(initial=initial):
                plugin = self.make_plugin(initial)
                expected = {**plugin.settings, "auto_hdr_enabled": not initial}
                snapshots = []
                with patch.object(plugin, "_save_settings", side_effect=lambda: snapshots.append(dict(plugin.settings))):
                    result = await plugin.set_auto_hdr_enabled(not initial)
                self.assertEqual(result, expected)
                self.assertEqual(snapshots, [expected])


if __name__ == "__main__":
    unittest.main()
