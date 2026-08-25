#!/usr/bin/env python3

import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


USER_AGENT = "DeckyHDR/0.1 (local development)"


class NoRedirect(
    urllib.request.HTTPRedirectHandler
):
    def redirect_request(
        self,
        req,
        fp,
        code,
        msg,
        headers,
        newurl,
    ):
        return None


def get_pcgw_page(appid: str) -> str:
    url = (
        "https://www.pcgamingwiki.com/api/appid.php"
        f"?appid={urllib.parse.quote(appid)}"
    )

    opener = urllib.request.build_opener(
        NoRedirect
    )

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
        },
    )

    try:
        response = opener.open(
            request,
            timeout=15,
        )

        body = response.read().decode(
            "utf-8",
            errors="replace",
        )

        if "No such AppID" in body:
            return ""

    except urllib.error.HTTPError as e:
        if e.code not in (
            301,
            302,
            303,
            307,
            308,
        ):
            raise

        location = e.headers.get(
            "Location"
        )

        if not location:
            raise RuntimeError(
                "PCGamingWiki returned a redirect "
                "without Location header."
            )

        parsed = urllib.parse.urlparse(
            location
        )

        if not parsed.path.startswith(
            "/wiki/"
        ):
            raise RuntimeError(
                "Unexpected PCGamingWiki redirect: "
                f"{location}"
            )

        page = parsed.path.removeprefix(
            "/wiki/"
        )

        return urllib.parse.unquote(
            page
        )

    return ""


def get_wikitext(page: str) -> str:
    params = urllib.parse.urlencode({
        "action": "parse",
        "format": "json",
        "redirects": "1",
        "prop": "wikitext",
        "page": page,
    })

    url = (
        "https://www.pcgamingwiki.com/"
        f"w/api.php?{params}"
    )

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
        },
    )

    with urllib.request.urlopen(
        request,
        timeout=15,
    ) as response:
        data = json.load(response)

    if "error" in data:
        raise RuntimeError(
            data["error"].get(
                "info",
                "MediaWiki API error",
            )
        )

    return data["parse"]["wikitext"]["*"]


def parse_hdr(wikitext: str) -> str:
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
        match.group(1)
        .strip()
        .lower()
    )

    if value in ("limited", "always on"):
        return "true"

    return value or "unknown"


def resolve(appid: str) -> dict:
    appid = str(appid).strip()

    if not re.fullmatch(
        r"\d+",
        appid,
    ):
        raise ValueError(
            "Steam App ID must contain only digits"
        )

    page = get_pcgw_page(appid)

    if not page:
        return {
            "appid": appid,
            "game": appid,
            "page": "",
            "hdr": "missing",
        }

    wikitext = get_wikitext(page)
    hdr = parse_hdr(wikitext)

    return {
        "appid": appid,
        "game": page.replace("_", " "),
        "page": page,
        "hdr": hdr,
    }


def main():
    if len(sys.argv) != 2:
        raise SystemExit(
            "Usage: pcgw_helper.py APPID"
        )

    try:
        result = resolve(
            sys.argv[1]
        )

        print(
            json.dumps(
                result,
                ensure_ascii=False,
            )
        )

    except Exception as e:
        print(
            f"{type(e).__name__}: {e}",
            file=sys.stderr,
        )
        raise SystemExit(1)


if __name__ == "__main__":
    main()
