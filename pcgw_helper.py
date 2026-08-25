#!/usr/bin/env python3

import difflib
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


def get_steam_game_name(appid: str) -> str:
    """
    Resolve the public Steam store name for an AppID.

    This is only used as a fallback when PCGamingWiki's
    custom appid.php redirect endpoint is unavailable.
    """
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


PACKAGING_SUFFIXES = (
    r"game\s+of\s+the\s+year(?:\s+edition)?",
    r"goty(?:\s+edition)?",
    r"complete(?:\s+edition)?",
    r"deluxe(?:\s+edition)?",
    r"ultimate(?:\s+edition)?",
    r"gold(?:\s+edition)?",
    r"premium(?:\s+edition)?",
    r"special(?:\s+edition)?",
    r"collector'?s(?:\s+edition)?",
)


def normalize_title(title: str) -> str:
    title = title.casefold()

    title = re.sub(
        r"[™®©]",
        "",
        title,
    )

    title = re.sub(
        r"[^a-z0-9]+",
        " ",
        title,
    )

    return " ".join(
        title.split()
    )


def title_search_variants(game_name: str) -> list[str]:
    variants = []

    def add(value: str):
        value = " ".join(value.strip().split())
        if value and value not in variants:
            variants.append(value)

    add(game_name)

    clean = re.sub(r"[™®©]", "", game_name).strip()
    add(clean)

    words = clean.split()

    # Generic search backoff:
    # progressively shorten the title from the end.
    # These variants only discover candidates.
    # The Steam AppID check decides whether a page is accepted.
    while len(words) > 1:
        words = words[:-1]
        add(" ".join(words))

    return variants


def get_pcgw_search_results(query: str) -> list[str]:
    params = urllib.parse.urlencode({
        "action": "opensearch",
        "search": query,
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
    ) as response:
        data = json.load(response)

    if (
        not isinstance(data, list)
        or len(data) < 2
        or not isinstance(data[1], list)
    ):
        return []

    return [
        str(value).strip()
        for value in data[1]
        if str(value).strip()
    ]


def page_mentions_appid(
    page: str,
    appid: str,
) -> bool:
    if not appid:
        return False

    try:
        wikitext = get_wikitext(page)
    except Exception:
        return False

    return bool(
        re.search(
            rf"(?<!\d){re.escape(appid)}(?!\d)",
            wikitext,
        )
    )


def search_pcgw_page(
    game_name: str,
    appid: str = "",
) -> str:
    if not game_name:
        return ""

    wanted = normalize_title(
        game_name
    )

    candidates = []

    for query in title_search_variants(
        game_name
    ):
        try:
            results = get_pcgw_search_results(
                query
            )
        except Exception:
            continue

        for page in results:
            if page not in candidates:
                candidates.append(page)

        # Exact normalized title always wins.
        for page in results:
            if normalize_title(page) == wanted:
                return page

        # Strongest general fallback:
        # the candidate page itself contains this Steam AppID.
        if appid:
            for page in results:
                if page_mentions_appid(
                    page,
                    appid,
                ):
                    return page

    if not candidates:
        return ""

    # Conservative final fallback based on title similarity.
    ranked = sorted(
        candidates,
        key=lambda page: difflib.SequenceMatcher(
            None,
            wanted,
            normalize_title(page),
        ).ratio(),
        reverse=True,
    )

    best = ranked[0]

    score = difflib.SequenceMatcher(
        None,
        wanted,
        normalize_title(best),
    ).ratio()

    return best if score >= 0.82 else ""


def get_pcgw_page(appid: str) -> str:
    """
    Resolve Steam AppID -> PCGamingWiki page.

    Primary:
        PCGW custom appid.php redirect API.

    Fallback:
        Steam public game name -> PCGW MediaWiki opensearch.

    The fallback protects the plugin against failures of
    PCGW's custom redirect endpoint while keeping the
    supported MediaWiki parse path unchanged.
    """
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
        if e.code in (
            301,
            302,
            303,
            307,
            308,
        ):
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

        # The custom appid.php endpoint is only an
        # optional fast path. It currently returns different
        # errors for valid Steam AppIDs, including 404 and 500,
        # while the normal MediaWiki API remains healthy.
        #
        # Any non-redirect HTTP error therefore falls through
        # to the robust Steam-name -> PCGW opensearch resolver.
        pass

    except (
        urllib.error.URLError,
        TimeoutError,
    ):
        # Network/path failure of the redirect endpoint.
        # Give the fallback path a chance.
        pass

    game_name = get_steam_game_name(
        appid
    )

    if game_name:
        page = search_pcgw_page(
            game_name,
            appid,
        )

        if page:
            return page

    # Old or delisted games may no longer resolve through
    # Steam's appdetails API. The public store page can still
    # expose the game title via its Open Graph metadata.
    url = (
        "https://store.steampowered.com/app/"
        f"{urllib.parse.quote(appid)}/?l=english"
    )

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
        },
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=15,
        ) as response:
            html_text = response.read().decode(
                "utf-8",
                errors="replace",
            )

        match = re.search(
            r'<meta\s+property="og:title"\s+content="([^"]+)"',
            html_text,
            flags=re.IGNORECASE,
        )

        if match:
            game_name = match.group(1).strip()

            game_name = re.sub(
                r"\s+on Steam$",
                "",
                game_name,
                flags=re.IGNORECASE,
            )

            if game_name:
                page = search_pcgw_page(
                    game_name
                )

                if page:
                    return page

    except (
        urllib.error.HTTPError,
        urllib.error.URLError,
        TimeoutError,
    ):
        pass

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
