import pytest

from inplace import htmldoc

DOC = """<!doctype html>
<html><head><style>p{color:red}</style></head>
<body>
<nav><a href="#x">Skip me</a></nav>
<section class="page">
<div class="body">
<h1>Title</h1>
<p class="lead">Hello <strong>world</strong> &amp; friends.</p>
<table><tbody><tr class="ft"><td><strong>Acme</strong><br>note</td><td>€12,400</td></tr></tbody></table>
<div class="pending"><strong>To do:</strong> finish.</div>
<figure><svg><text>chart</text></svg><figcaption>Caption</figcaption></figure>
<p data-locked>Generated total</p>
<ul><li>One</li><li><p>Nested</p></li></ul>
</div>
</section>
</body></html>
"""


def ids(source):
    root = htmldoc.parse(source)
    return [(n.tag, n.attrs.get("data-id")) for n in htmldoc.editable_blocks(root)]


def test_picks_innermost_text_blocks_only():
    tags = [t for t, _ in ids(DOC)]
    assert tags == ["h1", "p", "td", "td", "div", "figcaption", "li", "p"]


def test_assign_ids_only_touches_start_tags():
    out, added = htmldoc.assign_ids(DOC)
    # 8 text blocks + section, div.body, table, tr, figure, svg, ul
    assert added == 15
    assert '<p data-id="p-1" class="lead">' in out
    assert '<div data-id="div-2" class="pending">' in out
    assert '<table data-id="table-1">' in out and '<tr data-id="tr-1" class="ft">' in out
    assert '<svg data-id="svg-1">' in out
    assert "<nav>" in out and "<tbody>" in out and "<text>" in out
    # Removing the inserted attributes gives back the original byte-for-byte.
    import re
    assert re.sub(r' data-id="[^"]+"', "", out) == DOC


def test_assign_ids_is_stable_and_skips_used_ids():
    once, _ = htmldoc.assign_ids(DOC)
    twice, added = htmldoc.assign_ids(once)
    assert added == 0 and twice == once
    # A new paragraph from the agent gets a fresh id, existing ones stay.
    edited = once.replace("<h1", '<p>New one</p>\n<h1')
    out, added = htmldoc.assign_ids(edited)
    assert added == 1
    assert '<p data-id="p-3">New one</p>' in out
    assert '<p data-id="p-1" class="lead">' in out


def test_patch_block_replaces_inner_html_only():
    src, _ = htmldoc.assign_ids(DOC)
    # Browser serialisation differs from the source (&amp; vs &, quoting);
    # that must still count as "unchanged".
    old = "Hello <strong>world</strong> &amp; friends."
    out = htmldoc.patch_block(src, "p-1", old, "Hi <strong>world</strong>.")
    assert '<p data-id="p-1" class="lead">Hi <strong>world</strong>.</p>' in out
    assert out.replace("Hi <strong>world</strong>.", old) == src


def test_patch_block_detects_concurrent_agent_edit():
    src, _ = htmldoc.assign_ids(DOC)
    agent = src.replace("Hello <strong>world</strong>", "Hello <strong>agent</strong>")
    with pytest.raises(htmldoc.BlockConflict):
        htmldoc.patch_block(agent, "p-1", "Hello <strong>world</strong> &amp; friends.", "mine")


def test_patch_block_merges_edits_in_different_blocks():
    src, _ = htmldoc.assign_ids(DOC)
    agent = src.replace(">Title<", ">New title<")
    out = htmldoc.patch_block(agent, "p-1", "Hello <strong>world</strong> &amp; friends.", "Mine")
    assert ">New title<" in out and '>Mine</p>' in out


def test_whitespace_and_nbsp_are_not_changes():
    assert htmldoc.canonical("a\n  b&nbsp;c<br/>") == htmldoc.canonical("a b c<br>")


def test_unknown_block():
    with pytest.raises(htmldoc.BlockNotFound):
        htmldoc.patch_block(DOC, "nope", "", "x")


def test_containers_are_anchors_not_editable():
    src, _ = htmldoc.assign_ids(DOC)
    ids = htmldoc.editable_ids(src)
    assert "p-1" in ids and "td-1" in ids
    assert not {"table-1", "tr-1", "figure-1", "svg-1", "div-1"} & set(ids)
    with pytest.raises(htmldoc.BlockNotFound):
        htmldoc.patch_block(src, "table-1", "", "gone")
