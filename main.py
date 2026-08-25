import asyncio
import html
import json
import os
import re
import ssl
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

import decky


USER_AGENT = "DeckyHDR/0.1 (local development)"
CACHE_MAX_AGE = 30 * 24 * 60 * 60
STEAM_HDR_CURATOR_CACHE_MAX_AGE = 7 * 24 * 60 * 60

DEFAULT_SETTINGS = {
    "auto_hdr_enabled": False,
    "restore_previous_hdr_state": True,
    "override_appids": [],
}



def _pcgw_ssl_context():
    candidates = (
        "/etc/ssl/certs/ca-certificates.crt",
        "/etc/pki/tls/certs/ca-bundle.crt",
        "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
        "/etc/ssl/cert.pem",
    )

    for cafile in candidates:
        if not os.path.isfile(cafile):
            continue

        try:
            return ssl.create_default_context(
                cafile=cafile
            )
        except Exception:
            continue

    return ssl.create_default_context()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Plugin:
    # ------------------------------------------------------------------
    # Persistent plugin settings
    # ------------------------------------------------------------------

    def _settings_path(self):
        return os.path.join(
            decky.DECKY_PLUGIN_SETTINGS_DIR,
            "settings.json",
        )

    def _load_settings(self):
        settings = dict(DEFAULT_SETTINGS)
        path = self._settings_path()

        try:
            with open(path, "r", encoding="utf-8") as f:
                saved = json.load(f)

            if isinstance(saved, dict):
                for key in DEFAULT_SETTINGS:
                    if key in saved:
                        settings[key] = saved[key]

        except FileNotFoundError:
            pass

        except Exception:
            decky.logger.exception(
                "Could not read Decky HDR settings"
            )

        settings["auto_hdr_enabled"] = bool(
            settings["auto_hdr_enabled"]
        )

        settings["restore_previous_hdr_state"] = bool(
            settings["restore_previous_hdr_state"]
        )

        override_appids = settings.get(
            "override_appids",
            settings.get(
                "force_hdr_appids",
                [],
            ),
        )

        if not isinstance(override_appids, list):
            override_appids = []

        settings["override_appids"] = [
            str(appid)
            for appid in override_appids
            if str(appid).isdigit()
        ]

        settings.pop(
            "force_hdr_appids",
            None,
        )

        return settings

    def _save_settings(self):
        path = self._settings_path()

        try:
            os.makedirs(
                decky.DECKY_PLUGIN_SETTINGS_DIR,
                exist_ok=True,
            )

            tmp = path + ".tmp"

            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(
                    self.settings,
                    f,
                    ensure_ascii=False,
                    indent=2,
                )

            os.replace(tmp, path)

        except Exception:
            decky.logger.exception(
                "Could not save Decky HDR settings"
            )
            raise

    async def get_settings(self):
        return dict(self.settings)

    async def set_auto_hdr_enabled(self, enabled: bool):
        self.settings["auto_hdr_enabled"] = bool(enabled)
        self._save_settings()

        decky.logger.info(
            "Automatic HDR switching manually set to: %s",
            self.settings["auto_hdr_enabled"],
        )

        return dict(self.settings)

    async def set_restore_previous_hdr_state(
        self,
        enabled: bool,
    ):
        self.settings["restore_previous_hdr_state"] = bool(enabled)
        self._save_settings()

        decky.logger.info(
            "Restore previous HDR state manually set to: %s",
            self.settings["restore_previous_hdr_state"],
        )

        return dict(self.settings)

    async def set_hdr_override_for_app(
        self,
        appid: str,
        enabled: bool,
    ):
        appid = str(appid).strip()

        if not re.fullmatch(r"\d+", appid):
            raise ValueError(
                "Steam App ID must contain only digits"
            )

        current = set(
            self.settings.get(
                "override_appids",
                [],
            )
        )

        if enabled:
            current.add(appid)
        else:
            current.discard(appid)

        self.settings["override_appids"] = sorted(
            current,
            key=int,
        )

        self._save_settings()

        decky.logger.info(
            "HDR override for app %s set to: %s",
            appid,
            bool(enabled),
        )

        return dict(self.settings)

    # ------------------------------------------------------------------
    # PCGamingWiki cache
    # ------------------------------------------------------------------

    def _cache_path(self):
        return os.path.join(
            decky.DECKY_PLUGIN_RUNTIME_DIR,
            "hdr_cache.json",
        )

    def _steam_hdr_curator_cache_path(self):
        return os.path.join(
            decky.DECKY_PLUGIN_RUNTIME_DIR,
            "steam_hdr_curator_cache.json",
        )

    def _load_steam_hdr_curator_cache(self):
        path = self._steam_hdr_curator_cache_path()

        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)

            if isinstance(data, dict):
                return data

        except FileNotFoundError:
            pass

        except Exception:
            decky.logger.exception(
                "Could not read Steam HDR Curator cache"
            )

        return {}

    def _save_steam_hdr_curator_cache(self):
        path = self._steam_hdr_curator_cache_path()

        try:
            os.makedirs(
                decky.DECKY_PLUGIN_RUNTIME_DIR,
                exist_ok=True,
            )

            tmp = path + ".tmp"

            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(
                    self.steam_hdr_curator_cache,
                    f,
                    ensure_ascii=False,
                    indent=2,
                )

            os.replace(tmp, path)

        except Exception:
            decky.logger.exception(
                "Could not save Steam HDR Curator cache"
            )

    def _fetch_steam_hdr_curator_sync(self):
        base_url = (
            "https://store.steampowered.com/"
            "curator/33286359/"
            "ajaxgetfilteredrecommendations/"
        )

        params = urllib.parse.urlencode({
            "query": "",
            "start": 0,
            "count": 100,
            "dynamic_data": "",
            "tagids": "",
            "sort": "newest",
        })

        request = urllib.request.Request(
            f"{base_url}?{params}",
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/json",
            },
        )

        with urllib.request.urlopen(
            request,
            timeout=20,
            context=_pcgw_ssl_context(),
        ) as response:
            data = json.load(response)

        results_html = data.get(
            "results_html",
            "",
        )

        pattern = re.compile(
            r'href="[^"]*/app/(\d+)/[^"]*" '
            r'class="recommendation_link">.*?'
            r'<div class="recommendation_desc">'
            r'\s*(.*?)\s*</div>',
            flags=re.DOTALL,
        )

        entries = {}

        for appid, description in pattern.findall(
            results_html
        ):
            description = re.sub(
                r"<[^>]+>",
                "",
                description,
            )
            description = html.unescape(
                description
            )
            description = " ".join(
                description.split()
            )

            text = description.lower()

            if (
                "used to have native support" in text
                and "dropped" in text
            ):
                status = "other"

            elif (
                "native support" in text
                or "native suport" in text
            ):
                status = "native"

            elif "workaround" in text:
                status = "workaround"

            elif "windows auto hdr" in text:
                status = "autohdr"

            else:
                status = "other"

            entries[appid] = {
                "status": status,
                "description": description,
            }

        if not entries:
            raise RuntimeError(
                "Steam HDR Curator returned no parseable recommendations"
            )

        decky.logger.info(
            "Steam HDR Curator fetched: %d entries",
            len(entries),
        )

        return entries

    def _get_steam_hdr_curator_entries_sync(self):
        cache = self.steam_hdr_curator_cache

        if isinstance(cache, dict):
            timestamp = cache.get(
                "timestamp",
                0,
            )
            entries = cache.get(
                "entries",
            )

            if (
                isinstance(entries, dict)
                and time.time() - timestamp
                <= STEAM_HDR_CURATOR_CACHE_MAX_AGE
            ):
                return entries

        entries = self._fetch_steam_hdr_curator_sync()

        self.steam_hdr_curator_cache = {
            "timestamp": time.time(),
            "entries": entries,
        }

        self._save_steam_hdr_curator_cache()

        return entries

    def _load_cache(self):
        path = self._cache_path()

        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)

            if isinstance(data, dict):
                return data

        except FileNotFoundError:
            pass

        except Exception:
            decky.logger.exception(
                "Could not read HDR cache"
            )

        return {}

    def _save_cache(self):
        path = self._cache_path()

        try:
            os.makedirs(
                decky.DECKY_PLUGIN_RUNTIME_DIR,
                exist_ok=True,
            )

            tmp = path + ".tmp"

            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(
                    self.cache,
                    f,
                    ensure_ascii=False,
                    indent=2,
                )

            os.replace(tmp, path)

        except Exception:
            decky.logger.exception(
                "Could not save HDR cache"
            )

    def _get_cached(self, appid):
        item = self.cache.get(appid)

        if not isinstance(item, dict):
            return None

        timestamp = item.get("timestamp", 0)

        if time.time() - timestamp > CACHE_MAX_AGE:
            return None

        result = item.get("result")

        if not isinstance(result, dict):
            return None

        return result

    def _set_cached(self, appid, result):
        cached_result = dict(result)

        # This is runtime information and should not be cached.
        cached_result.pop("cached", None)
        cached_result.pop("automatic_action", None)

        self.cache[appid] = {
            "timestamp": time.time(),
            "result": cached_result,
        }

        self._save_cache()

    # ------------------------------------------------------------------
    # PCGamingWiki resolver
    # ------------------------------------------------------------------

    def _get_steam_game_name(self, appid):
        params = urllib.parse.urlencode({
            "appids": appid,
            "l": "english",
        })

        url = (
            "https://store.steampowered.com/"
            f"api/appdetails?{params}"
        )

        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/json",
            },
        )

        with urllib.request.urlopen(
            request,
            timeout=15,
            context=_pcgw_ssl_context(),
        ) as response:
            data = json.load(response)

        entry = data.get(appid)

        if not isinstance(entry, dict):
            return ""

        if entry.get("success") is not True:
            return ""

        game_data = entry.get("data")

        if not isinstance(game_data, dict):
            return ""

        return str(
            game_data.get("name", "")
        ).strip()

    def _search_pcgw_page(self, game_name, appid=""):
        if not game_name:
            return ""

        variants = []

        def add_variant(value):
            value = " ".join(value.strip().split())
            if value and value not in variants:
                variants.append(value)

        add_variant(game_name)

        clean = re.sub(r"[™®©]", "", game_name).strip()
        add_variant(clean)

        words = clean.split()
        while len(words) > 1:
            words = words[:-1]
            add_variant(" ".join(words))

        for variant in variants:
            params = urllib.parse.urlencode({
                "action": "opensearch",
                "search": variant,
                "redirects": "resolve",
                "limit": 10,
                "format": "json",
            })

            url = (
                "https://www.pcgamingwiki.com/"
                f"w/api.php?{params}"
            )

            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "application/json",
                },
            )

            with urllib.request.urlopen(
                request,
                timeout=15,
                context=_pcgw_ssl_context(),
            ) as response:
                data = json.load(response)

            if (
                not isinstance(data, list)
                or len(data) < 2
                or not isinstance(data[1], list)
            ):
                continue

            results = [
                str(value).strip()
                for value in data[1]
                if str(value).strip()
            ]

            if appid:
                for page in results:
                    try:
                        wikitext = self._get_wikitext(page)
                    except Exception:
                        continue
                    if re.search(rf"(?<!\d){re.escape(appid)}(?!\d)", wikitext):
                        return page
                continue

            if results:
                wanted = game_name.casefold()
                for page in results:
                    if page.casefold() == wanted:
                        return page
                return results[0]

        return ""

        wanted = game_name.casefold()

        for page in results:
            if page.casefold() == wanted:
                return page

        return results[0]

    def _get_pcgw_page(self, appid):
        url = (
            "https://www.pcgamingwiki.com/api/appid.php"
            f"?appid={urllib.parse.quote(appid)}"
        )

        opener = urllib.request.build_opener(
            NoRedirect,
            urllib.request.HTTPSHandler(
                context=_pcgw_ssl_context()
            ),
        )

        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
            },
        )

        decky.logger.info(
            f"PCGW STEP 1 request: {url}"
        )

        try:
            opener.open(
                request,
                timeout=15,
            )

        except urllib.error.HTTPError as e:
            if e.code in (
                301,
                302,
                303,
                307,
                308,
            ):
                location = e.headers.get("Location")

                if not location:
                    raise RuntimeError(
                        "PCGamingWiki redirect has no "
                        "Location header"
                    )

                parsed = urllib.parse.urlparse(
                    location
                )

                if not parsed.path.startswith("/wiki/"):
                    raise RuntimeError(
                        "Unexpected PCGamingWiki redirect: "
                        f"{location}"
                    )

                page = parsed.path.removeprefix(
                    "/wiki/"
                )

                return urllib.parse.unquote(page)

            decky.logger.warning(
                "PCGW appid.php HTTP %s for %s, "
                "trying fallback",
                e.code,
                appid,
            )

        except (
            urllib.error.URLError,
            TimeoutError,
        ) as e:
            decky.logger.warning(
                "PCGW appid.php failed for %s: %s",
                appid,
                e,
            )

        try:
            game_name = self._get_steam_game_name(
                appid
            )

            if game_name:
                page = self._search_pcgw_page(
                    game_name,
                    appid,
                )

                if page:
                    return page

        except Exception:
            decky.logger.exception(
                "PCGW fallback failed for app %s",
                appid,
            )

        return ""

    def _get_wikitext(self, page):
        params = urllib.parse.urlencode({
            "action": "parse",
            "format": "json",
            "redirects": "1",
            "prop": "wikitext",
            "page": page,
        })

        url = (
            "https://www.pcgamingwiki.com/"
            "w/api.php?"
            + params
        )

        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
            },
        )

        decky.logger.info(
            f"PCGW STEP 2 request: {url}"
        )

        try:
            with urllib.request.urlopen(
                request,
                timeout=15,
                context=_pcgw_ssl_context(),
            ) as response:
                decky.logger.info(
                    f"PCGW STEP 2 HTTP {response.status}"
                )
                data = json.load(response)

        except urllib.error.HTTPError as e:
            decky.logger.error(
                f"PCGW STEP 2 HTTP {e.code}: {e.reason}"
            )
            decky.logger.error(
                f"PCGW STEP 2 headers: {dict(e.headers.items())}"
            )
            raise

        if "error" in data:
            raise RuntimeError(
                data["error"].get(
                    "info",
                    "MediaWiki API error",
                )
            )

        return data["parse"]["wikitext"]["*"]

    def _parse_hdr(self, wikitext):
        match = re.search(
            r"^\|\s*hdr\s*=\s*(.*?)\s*$",
            wikitext,
            flags=(
                re.MULTILINE
                | re.IGNORECASE
            ),
        )

        if not match:
            return "missing"

        value = (
            match
            .group(1)
            .strip()
            .lower()
        )

        return value or "unknown"

    # ------------------------------------------------------------------
    # Automatic HDR policy
    # ------------------------------------------------------------------

    def _automatic_action_for_hdr(self, hdr):
        """
        Safety-first policy:

        PCGamingWiki true:
            HDR ON

        Everything else:
            HDR OFF

        This intentionally means:
            false    -> SDR
            unknown  -> SDR
            missing  -> SDR
            n/a      -> SDR
            hackable -> SDR

        We do not guess HDR support.
        """
        if hdr == "true":
            return "enable"

        return "disable"

    def _apply_steam_hdr_curator_fallback_sync(
        self,
        result,
    ):
        hdr = str(
            result.get(
                "hdr",
                "missing",
            )
        ).strip().lower()

        if hdr == "true":
            result.setdefault(
                "source",
                "PCGamingWiki",
            )
            return result

        if hdr not in (
            "false",
            "missing",
            "unknown",
            "hackable",
            "n/a",
        ):
            result.setdefault(
                "source",
                "PCGamingWiki",
            )
            return result

        try:
            entries = (
                self._get_steam_hdr_curator_entries_sync()
            )
        except Exception:
            decky.logger.exception(
                "Steam HDR Curator lookup failed"
            )
            result.setdefault(
                "source",
                "PCGamingWiki",
            )
            return result

        appid = str(
            result.get(
                "appid",
                "",
            )
        )

        entry = entries.get(appid)

        if not isinstance(entry, dict):
            result.setdefault(
                "source",
                "PCGamingWiki",
            )
            return result

        status = entry.get(
            "status",
            "",
        )

        if status == "native":
            result = dict(result)
            result["hdr"] = "true"
            result["source"] = "Steam HDR Curator"
            result["source_detail"] = entry.get(
                "description",
                "",
            )

        elif status == "workaround":
            result = dict(result)
            result["hdr"] = "hackable"
            result["source"] = "Steam HDR Curator"
            result["source_detail"] = entry.get(
                "description",
                "",
            )

        else:
            result.setdefault(
                "source",
                "PCGamingWiki",
            )

        return result

    def _decorate_result(
        self,
        result,
        cached,
    ):
        decorated = dict(result)

        decorated["cached"] = cached
        decorated["automatic_action"] = (
            self._automatic_action_for_hdr(
                decorated.get(
                    "hdr",
                    "missing",
                )
            )
        )

        return decorated

    def _resolve_sync(self, appid):
        appid = str(appid).strip()

        if not re.fullmatch(
            r"\d+",
            appid,
        ):
            raise ValueError(
                "Steam App ID must contain "
                "only digits"
            )

        helper = os.path.join(
            os.path.dirname(
                os.path.abspath(__file__)
            ),
            "pcgw_helper.py",
        )

        if not os.path.isfile(helper):
            raise RuntimeError(
                "PCGamingWiki helper is missing"
            )

        decky.logger.info(
            "PCGW lookup via system Python: "
            f"appid={appid}"
        )

        helper_env = os.environ.copy()

        # Decky plugins run inside PluginLoader's embedded
        # runtime. A child /usr/bin/python3 inherits that
        # environment unless we explicitly sanitize it.
        #
        # In particular, foreign loader/Python variables can
        # prevent the system Python SSL module from loading,
        # which makes urllib report:
        #
        #   unknown url type: https
        #
        # Remove runtime-specific overrides so the helper
        # behaves like /usr/bin/python3 in a normal shell.
        for variable in (
            "LD_LIBRARY_PATH",
            "LD_PRELOAD",
            "LD_AUDIT",
            "PYTHONHOME",
            "PYTHONPATH",
            "PYTHONEXECUTABLE",
            "PYTHONUSERBASE",
        ):
            helper_env.pop(
                variable,
                None,
            )

        helper_env["PATH"] = (
            "/usr/local/bin:"
            "/usr/bin:"
            "/bin"
        )

        helper_env["SSL_CERT_FILE"] = (
            "/etc/pki/tls/cert.pem"
        )

        helper_env["SSL_CERT_DIR"] = (
            "/etc/pki/tls/certs"
        )

        decky.logger.info(
            "PCGW helper runtime: "
            "/usr/bin/python3 with sanitized environment"
        )

        try:
            completed = subprocess.run(
                [
                    "/usr/bin/python3",
                    "-I",
                    helper,
                    appid,
                ],
                capture_output=True,
                text=True,
                timeout=35,
                check=False,
                env=helper_env,
                cwd=os.path.dirname(helper),
            )

        except subprocess.TimeoutExpired:
            raise RuntimeError(
                "PCGamingWiki helper timed out"
            )

        if completed.returncode != 0:
            error = (
                completed.stderr.strip()
                or completed.stdout.strip()
                or (
                    "PCGamingWiki helper failed "
                    f"with exit code "
                    f"{completed.returncode}"
                )
            )

            decky.logger.error(
                f"PCGW helper error: {error}"
            )

            raise RuntimeError(error)

        stdout = completed.stdout.strip()

        if not stdout:
            raise RuntimeError(
                "PCGamingWiki helper returned "
                "no data"
            )

        try:
            result = json.loads(stdout)

        except json.JSONDecodeError as e:
            raise RuntimeError(
                "PCGamingWiki helper returned "
                f"invalid JSON: {e}"
            )

        required = (
            "appid",
            "game",
            "page",
            "hdr",
        )

        for key in required:
            if key not in result:
                raise RuntimeError(
                    "PCGamingWiki helper result "
                    f"is missing: {key}"
                )

        decky.logger.info(
            "PCGW helper success: "
            f"appid={result['appid']} "
            f"game={result['game']} "
            f"hdr={result['hdr']}"
        )

        return result

    async def get_hdr_info(
        self,
        appid: str,
    ):
        appid = str(appid).strip()

        cached = self._get_cached(appid)

        if cached is not None:
            return self._decorate_result(
                cached,
                True,
            )

        result = await asyncio.to_thread(
            self._resolve_sync,
            appid,
        )

        result = await asyncio.to_thread(
            self._apply_steam_hdr_curator_fallback_sync,
            result,
        )

        self._set_cached(
            appid,
            result,
        )

        return self._decorate_result(
            result,
            False,
        )

    async def clear_cache(self):
        self.cache = {}
        self._save_cache()

        return True

    # ------------------------------------------------------------------
    # Gamescope diagnostics
    # ------------------------------------------------------------------

    async def get_gamescope_diagnostics(self):
        import stat

        executable = shutil.which("gamescopectl")

        result = {
            "gamescopectl": executable or "",
            "gamescope_wayland_display": "",
            "available": bool(executable),
            "connected": False,
            "returncode": None,
            "stdout": "",
            "stderr": "",
        }

        if not executable:
            result["stderr"] = "gamescopectl was not found."
            return result

        candidates = []
        debug_lines = []

        # --------------------------------------------------------------
        # 1. Umgebungen laufender Prozesse untersuchen
        # --------------------------------------------------------------
        proc_root = "/proc"

        try:
            pids = [
                name for name in os.listdir(proc_root)
                if name.isdigit()
            ]
        except Exception as e:
            pids = []
            debug_lines.append(
                f"Could not enumerate /proc: {e}"
            )

        seen = set()

        for pid in pids:
            proc_dir = os.path.join(proc_root, pid)

            try:
                with open(
                    os.path.join(proc_dir, "cmdline"),
                    "rb"
                ) as f:
                    cmdline = (
                        f.read()
                        .replace(b"\x00", b" ")
                        .decode("utf-8", "ignore")
                    )
            except Exception:
                continue

            lower_cmd = cmdline.lower()

            # Nur interessante Session-Prozesse untersuchen.
            if not any(
                token in lower_cmd
                for token in (
                    "gamescope",
                    "steam",
                    "steamwebhelper",
                )
            ):
                continue

            try:
                with open(
                    os.path.join(proc_dir, "environ"),
                    "rb"
                ) as f:
                    raw = f.read()

                env = {}

                for entry in raw.split(b"\x00"):
                    if b"=" not in entry:
                        continue

                    key, value = entry.split(b"=", 1)

                    env[
                        key.decode("utf-8", "ignore")
                    ] = value.decode(
                        "utf-8",
                        "ignore"
                    )

            except Exception:
                continue

            runtime_dir = env.get(
                "XDG_RUNTIME_DIR",
                ""
            )

            gs_display = env.get(
                "GAMESCOPE_WAYLAND_DISPLAY",
                ""
            )

            if runtime_dir and gs_display:
                key = (
                    runtime_dir,
                    gs_display,
                )

                if key not in seen:
                    seen.add(key)

                    candidates.append({
                        "runtime_dir": runtime_dir,
                        "display": gs_display,
                        "source": (
                            f"process {pid}: "
                            f"{cmdline[:120]}"
                        ),
                    })

        # --------------------------------------------------------------
        # 2. Falls Prozess-Environment nichts liefert:
        #    /run/user/* nach Gamescope-Sockets durchsuchen
        # --------------------------------------------------------------
        runtime_roots = []

        for base in (
            "/run/user",
            "/var/run/user",
        ):
            if not os.path.isdir(base):
                continue

            try:
                for uid in os.listdir(base):
                    path_uid = os.path.join(
                        base,
                        uid
                    )

                    if os.path.isdir(path_uid):
                        runtime_roots.append(
                            path_uid
                        )
            except Exception:
                pass

        for runtime_dir in runtime_roots:
            try:
                entries = os.listdir(
                    runtime_dir
                )
            except Exception:
                continue

            for name in entries:
                if not (
                    name.startswith("gamescope")
                    or name.startswith("wayland-")
                ):
                    continue

                socket_path = os.path.join(
                    runtime_dir,
                    name
                )

                try:
                    mode = os.stat(
                        socket_path
                    ).st_mode

                    if not stat.S_ISSOCK(mode):
                        continue

                except Exception:
                    continue

                key = (
                    runtime_dir,
                    name,
                )

                if key in seen:
                    continue

                seen.add(key)

                candidates.append({
                    "runtime_dir": runtime_dir,
                    "display": name,
                    "source": "runtime socket scan",
                })

        debug_lines.append(
            f"Found {len(candidates)} candidate session(s)."
        )

        # --------------------------------------------------------------
        # 3. Kandidaten READ-ONLY testen
        # --------------------------------------------------------------
        for candidate in candidates:
            env = os.environ.copy()

            env["XDG_RUNTIME_DIR"] = (
                candidate["runtime_dir"]
            )

            env[
                "GAMESCOPE_WAYLAND_DISPLAY"
            ] = candidate["display"]

            try:
                proc = await asyncio.to_thread(
                    subprocess.run,
                    [
                        executable,
                        "hdr_enabled",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=5,
                    env=env,
                )

            except Exception as e:
                debug_lines.append(
                    f"{candidate['display']}: {e}"
                )
                continue

            stdout = proc.stdout.strip()
            stderr = proc.stderr.strip()

            debug_lines.append(
                "{} -> rc={} source={}".format(
                    candidate["display"],
                    proc.returncode,
                    candidate["source"],
                )
            )

            if proc.returncode == 0:
                result[
                    "gamescope_wayland_display"
                ] = candidate["display"]

                result["connected"] = True
                result["returncode"] = 0
                result["stdout"] = stdout

                result["stderr"] = (
                    "XDG_RUNTIME_DIR="
                    + candidate["runtime_dir"]
                    + "\nSource: "
                    + candidate["source"]
                )

                return result

            if stderr:
                debug_lines.append(
                    stderr[:300]
                )

        # --------------------------------------------------------------
        # Kein Kandidat funktionierte
        # --------------------------------------------------------------
        result["returncode"] = 1

        if candidates:
            result[
                "gamescope_wayland_display"
            ] = candidates[0]["display"]

        result["stderr"] = "\n".join(
            debug_lines
        ) or "No Gamescope session candidates found."

        return result


    # ------------------------------------------------------------------
    # Gamescope HDR control
    # ------------------------------------------------------------------

    def _parse_gamescope_hdr_state(self, output):
        text = (output or "").strip().lower()

        patterns = [
            r"\bhdr_enabled\b\s*(?:=|:)?\s*(true|false|1|0|on|off)\b",
            r"\b(true|false)\b",
        ]

        for pattern in patterns:
            match = re.search(pattern, text)

            if not match:
                continue

            value = match.group(1)

            if value in ("true", "1", "on"):
                return True

            if value in ("false", "0", "off"):
                return False

        return None


    async def _get_working_gamescope_env(self):
        diagnostics = await self.get_gamescope_diagnostics()

        if not diagnostics.get("connected"):
            raise RuntimeError(
                diagnostics.get("stderr")
                or "Could not connect to Gamescope."
            )

        display = diagnostics.get(
            "gamescope_wayland_display",
            ""
        )

        message = diagnostics.get(
            "stderr",
            ""
        )

        match = re.search(
            r"XDG_RUNTIME_DIR=([^\n]+)",
            message
        )

        runtime_dir = (
            match.group(1).strip()
            if match
            else ""
        )

        if not display:
            raise RuntimeError(
                "Gamescope display was not detected."
            )

        if not runtime_dir:
            raise RuntimeError(
                "XDG_RUNTIME_DIR was not detected."
            )

        env = os.environ.copy()

        env["XDG_RUNTIME_DIR"] = runtime_dir
        env[
            "GAMESCOPE_WAYLAND_DISPLAY"
        ] = display

        return env, display, runtime_dir


    async def _run_gamescopectl(self, *args):
        executable = shutil.which(
            "gamescopectl"
        )

        if not executable:
            raise RuntimeError(
                "gamescopectl was not found."
            )

        env, display, runtime_dir = (
            await self._get_working_gamescope_env()
        )

        proc = await asyncio.to_thread(
            subprocess.run,
            [
                executable,
                *[str(arg) for arg in args],
            ],
            capture_output=True,
            text=True,
            timeout=10,
            env=env,
        )

        return {
            "returncode": proc.returncode,
            "stdout": proc.stdout.strip(),
            "stderr": proc.stderr.strip(),
            "display": display,
            "runtime_dir": runtime_dir,
        }


    async def get_gamescope_hdr_state(self):
        result = await self._run_gamescopectl(
            "hdr_enabled"
        )

        combined = "\n".join(
            part
            for part in (
                result["stdout"],
                result["stderr"],
            )
            if part
        )

        state = self._parse_gamescope_hdr_state(
            combined
        )

        return {
            "success": (
                result["returncode"] == 0
                and state is not None
            ),
            "enabled": state,
            "raw": combined,
            "returncode": result["returncode"],
            "display": result["display"],
        }


    async def set_gamescope_hdr(self, enabled):
        enabled = bool(enabled)

        before = (
            await self.get_gamescope_hdr_state()
        )

        # Safety: Don't change anything unless the
        # previous state can be determined reliably.
        if not before["success"]:
            return {
                "success": False,
                "error": (
                    "Current HDR state could not "
                    "be determined. Nothing changed."
                ),
                "before": before,
                "after": before,
                "saved_previous": getattr(
                    self,
                    "_manual_previous_hdr_state",
                    None,
                ),
            }

        previous = getattr(
            self,
            "_manual_previous_hdr_state",
            None,
        )

        if previous is None:
            self._manual_previous_hdr_state = (
                before["enabled"]
            )

        command = await self._run_gamescopectl(
            "hdr_enabled",
            "1" if enabled else "0",
        )

        if command["returncode"] != 0:
            return {
                "success": False,
                "error": (
                    command["stderr"]
                    or command["stdout"]
                    or "gamescopectl failed."
                ),
                "before": before,
                "after": before,
                "saved_previous": getattr(
                    self,
                    "_manual_previous_hdr_state",
                    None,
                ),
            }

        # Give Gamescope a brief moment to apply
        # the runtime ConVar before reading it back.
        await asyncio.sleep(0.25)

        after = (
            await self.get_gamescope_hdr_state()
        )

        success = (
            after["success"]
            and after["enabled"] == enabled
        )

        return {
            "success": success,
            "error": (
                ""
                if success
                else "HDR state did not verify."
            ),
            "before": before,
            "after": after,
            "saved_previous": getattr(
                self,
                "_manual_previous_hdr_state",
                None,
            ),
        }


    async def restore_manual_hdr_state(self):
        previous = getattr(
            self,
            "_manual_previous_hdr_state",
            None,
        )

        if previous is None:
            return {
                "success": False,
                "error": (
                    "No previous manual HDR state "
                    "has been saved."
                ),
                "after": (
                    await self.get_gamescope_hdr_state()
                ),
                "saved_previous": None,
            }

        command = await self._run_gamescopectl(
            "hdr_enabled",
            "1" if previous else "0",
        )

        if command["returncode"] != 0:
            return {
                "success": False,
                "error": (
                    command["stderr"]
                    or command["stdout"]
                    or "gamescopectl failed."
                ),
                "after": (
                    await self.get_gamescope_hdr_state()
                ),
                "saved_previous": previous,
            }

        await asyncio.sleep(0.25)

        after = (
            await self.get_gamescope_hdr_state()
        )

        success = (
            after["success"]
            and after["enabled"] == previous
        )

        if success:
            self._manual_previous_hdr_state = None

        return {
            "success": success,
            "error": (
                ""
                if success
                else "Restored state did not verify."
            ),
            "after": after,
            "saved_previous": (
                None if success else previous
            ),
        }


    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def _main(self):
        self.settings = self._load_settings()
        self.cache = self._load_cache()
        self.steam_hdr_curator_cache = (
            self._load_steam_hdr_curator_cache()
        )

        decky.logger.info(
            "Decky HDR started"
        )

        decky.logger.info(
            "Automatic HDR switching: %s",
            self.settings["auto_hdr_enabled"],
        )

        decky.logger.info(
            "Restore previous HDR state: %s",
            self.settings[
                "restore_previous_hdr_state"
            ],
        )

        decky.logger.info(
            "HDR cache entries: %d",
            len(self.cache),
        )

    async def _unload(self):
        self._save_settings()
        self._save_cache()
        self._save_steam_hdr_curator_cache()

        decky.logger.info(
            "Decky HDR stopped"
        )
