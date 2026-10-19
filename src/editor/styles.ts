// --- status pill (kept out of print and out of the document's own flow) ---
const style = document.createElement("style");
style.dataset.inplaceUi = "";
style.textContent = `
  [data-id][contenteditable]{outline:none;border-radius:2px;transition:box-shadow .15s}
  [data-id][contenteditable]:hover{box-shadow:0 0 0 2px #4a7bd433}
  [data-id][contenteditable]:focus{box-shadow:0 0 0 2px #4a7bd4aa}
  [data-id].inplace-conflict{box-shadow:0 0 0 2px #d4734a!important}
  [data-id].inplace-changed{background-color:#c4b2ff38!important}
  [data-id].inplace-changed-fade{animation:inplace-ink .9s cubic-bezier(.2,.7,.2,1),inplace-shimmer 1.6s cubic-bezier(.4,0,.2,1) .1s,
    inplace-glow 3s ease-out,inplace-fade 2.6s ease-in 1.8s both}
  @keyframes inplace-ink{from{opacity:.25;filter:blur(3px)}to{opacity:1;filter:blur(0)}}
  @keyframes inplace-fade{from{background-color:#c4b2ff38}}
  @keyframes inplace-shimmer{from,to{background-image:linear-gradient(105deg,transparent 28%,#f6c3e033 40%,#fff6dcd9 50%,#cdbdff66 60%,transparent 72%);
    background-size:320% 100%;background-repeat:no-repeat}from{background-position:100% 0}to{background-position:0 0}}
  @keyframes inplace-glow{from,to{box-shadow:0 0 0 1px #a58bff00,0 0 0 #f29fc500,0 0 0 #9b7bff00}
    22%{box-shadow:0 0 0 1px #b39cffa6,-10px 2px 26px #f29fc54d,10px -2px 26px #9b7bff59}}
  .inplace-sparkle{position:fixed;z-index:2147483646;pointer-events:none;display:block;
    filter:drop-shadow(0 0 3px currentColor) drop-shadow(0 0 7px currentColor);animation:inplace-sparkle var(--t) cubic-bezier(.2,.6,.3,1) both}
  .inplace-sparkle svg{display:block;width:100%;height:100%}
  .inplace-sparkle.dot{border-radius:50%;background:currentColor}
  @keyframes inplace-sparkle{from{opacity:0;transform:translate(0,0) scale(0) rotate(0)}
    30%{opacity:1;transform:translate(calc(var(--dx)*.35),calc(var(--dy)*.35)) scale(1) rotate(calc(var(--rot)*.4))}
    to{opacity:0;transform:translate(var(--dx),var(--dy)) scale(.2) rotate(var(--rot))}}
  #inplace-status[data-owner=changes]{opacity:.96;border:1px solid transparent;padding:6px 11px 6px 9px;
    background:linear-gradient(#1f2a24,#1f2a24) padding-box,linear-gradient(100deg,#9b7bff,#f29fc5,#e9c46a,#9b7bff) 0 0/300% 100% border-box;
    animation:inplace-border 5s linear infinite}
  @keyframes inplace-border{to{background-position:0 0,300% 0}}
  #inplace-status .star{display:inline-block;width:12px;height:12px;margin-right:6px;vertical-align:-1.5px;color:#f1d27a;
    filter:drop-shadow(0 0 3px #f1d27a99);animation:inplace-twinkle 1.4s ease-in-out 2}
  #inplace-status .star svg{display:block;width:100%;height:100%}
  @keyframes inplace-twinkle{50%{transform:scale(.6) rotate(45deg);opacity:.6}}
  @media (prefers-reduced-motion:reduce){[data-id].inplace-changed-fade{animation:inplace-fade 4.4s steps(1,end) both}.inplace-sparkle{display:none}
    #inplace-status[data-owner=changes],#inplace-status .star{animation:none}}
  #inplace-status{position:fixed;right:14px;bottom:14px;z-index:2147483647;font:12px/1.3 -apple-system,system-ui,sans-serif;
    background:#1f2a24;color:#fff;padding:7px 11px;border-radius:7px;box-shadow:0 3px 12px #0003;max-width:340px;opacity:.88}
  #inplace-status[data-kind=error]{background:#9c3b1c}
  #inplace-status button{all:unset;margin-left:10px;font-weight:600;text-decoration:underline;cursor:pointer}
  .inplace-grip{position:fixed;z-index:2147483646;width:18px;height:22px;padding:0;margin:0;border:0;border-radius:4px;
    background:#fff;color:#7a8580;box-shadow:0 1px 4px #0002;font:14px/22px system-ui,sans-serif;letter-spacing:-3px;
    text-align:center;cursor:grab;user-select:none;touch-action:none}
  .inplace-grip:hover{color:#1f2a24;background:#eef2fb}
  .inplace-add{letter-spacing:0;font-size:17px;cursor:pointer}
  html.inplace-plain-links [data-id][contenteditable=true] a{text-decoration:underline}
  [data-id][contenteditable]:empty{min-height:1.2em}
  [data-id][contenteditable]:empty:focus::before{content:"Type here";color:#9aa39e;pointer-events:none}
  #inplace-outline{position:fixed;z-index:2147483645;pointer-events:none;border:2px solid #4a7bd4aa;border-radius:3px}
  #inplace-marker{position:fixed;z-index:2147483646;pointer-events:none;background:#4a7bd4;border-radius:2px}
  #inplace-tip{position:fixed;z-index:2147483647;display:none;box-sizing:border-box;max-width:min(360px,calc(100vw - 16px));
    padding:5px 9px;border-radius:7px;background:#fff;color:#1f2a24;box-shadow:0 3px 14px #0003,0 0 0 1px #0000000f;
    font:13px/1.4 -apple-system,system-ui,sans-serif;overflow-wrap:anywhere;pointer-events:none}
  #inplace-tip del{padding:0 2px;border-radius:3px;background:#fbe9e3;color:#a1452a;text-decoration:line-through;
    text-decoration-color:#a1452a88}
  @media print{#inplace-tip{display:none!important}}
  .inplace-dragging{opacity:.35}
  html.inplace-is-dragging,html.inplace-is-dragging *{cursor:grabbing!important;user-select:none!important}
  #inplace-toolbar{position:fixed;z-index:2147483647;display:none;align-items:center;gap:2px;padding:3px;border-radius:8px;
    background:#1f2a24;box-shadow:0 3px 12px #0004;font:13px/1 -apple-system,system-ui,sans-serif}
  #inplace-toolbar button{all:unset;box-sizing:border-box;min-width:28px;height:28px;padding:0 7px;border-radius:5px;
    color:#e8ece9;text-align:center;line-height:28px;cursor:pointer;font:inherit}
  #inplace-toolbar button:hover{background:#ffffff1f}
  #inplace-toolbar button[aria-pressed=true]{background:#ffffff33;color:#fff}
  #inplace-toolbar .sep{width:1px;height:18px;margin:0 4px;background:#ffffff33}
  #inplace-toolbar form{display:none;gap:4px;margin:0}
  #inplace-toolbar input{all:unset;box-sizing:border-box;width:240px;height:28px;padding:0 8px;border-radius:5px;
    background:#fff;color:#1f2a24;font:inherit}
  #inplace-toolbar.comment-only > :not([data-comment]){display:none}
  #inplace-toolbar.linking > :not(form){display:none}
  #inplace-toolbar.linking form{display:flex}
  #inplace-corner{all:unset;box-sizing:border-box;position:fixed;left:14px;bottom:14px;z-index:2147483647;display:none;
    align-items:center;justify-content:center;gap:7px;height:36px;padding:0 13px 0 9px;border-radius:18px;background:#1f2a24;color:#e8ece9;font-weight:600;
    font:12px/1.3 -apple-system,system-ui,sans-serif;cursor:pointer;box-shadow:0 3px 12px #0003}
  #inplace-corner.shown{display:flex}
  #inplace-corner:hover{background:#34433a}
  #inplace-corner:focus-visible{outline:2px solid #4a7bd4;outline-offset:2px}
  #inplace-corner svg{width:20px;height:20px}
  #inplace-corner .dot{position:absolute;top:0;right:0;width:9px;height:9px;border-radius:50%;background:#b39cff;
    box-shadow:0 0 0 2px #fff,0 0 8px #9b7bff}
  #inplace-corner.stash{width:auto;height:auto;padding:7px 12px;border-radius:7px;background:#9c3b1c;color:#fff}
  #inplace-corner.stash:hover{background:#b4461f}
  #inplace-changes{position:fixed;left:14px;bottom:60px;z-index:2147483647;display:none;flex-direction:column;box-sizing:border-box;
    width:min(380px,calc(100vw - 28px));max-height:min(70vh,560px);overflow:hidden;border-radius:12px;background:#fff;color:#1f2a24;
    box-shadow:0 12px 40px #0003,0 0 0 1px #0000000f;font:13px/1.45 -apple-system,system-ui,sans-serif;text-align:left}
  #inplace-changes.open{display:flex}
  #inplace-changes header{all:unset;display:block;padding:12px 10px 0 16px;border-bottom:1px solid #e4e8e5}
  #inplace-changes header .title{display:flex;align-items:center;justify-content:space-between}
  #inplace-changes .views{display:flex;flex-wrap:wrap;gap:4px 16px;padding:6px 0 10px}
  #inplace-changes h2{all:unset;font-size:14px;font-weight:600}
  #inplace-changes .x{all:unset;cursor:pointer;color:#7a8580;font-size:20px;line-height:1;padding:2px 7px 4px;border-radius:6px}
  #inplace-changes .x:hover{background:#eef1ef;color:#1f2a24}
  #inplace-changes footer{padding:8px 16px;border-top:1px solid #e4e8e5;color:#7a8580;font-size:11.5px;user-select:text;word-break:break-all}
  #inplace-changes .list{overflow:auto;padding:8px 8px 8px}
  #inplace-changes .agent-status{margin:0;padding-right:6px;font-size:12px;color:#7a8580}
  ::highlight(inplace-comment){background-color:#ffe08a}
  ::highlight(inplace-comment-draft){background-color:#ffe08a}
  ::highlight(inplace-agent-comment){background-color:#cfe0fb}
  #inplace-comment-layer .marker{all:unset;box-sizing:border-box;position:fixed;z-index:2147483646;min-width:20px;height:20px;padding:0 5px;
    border-radius:10px 10px 10px 3px;background:#e0a800;color:#1f2a24;font:600 11px/20px -apple-system,system-ui,sans-serif;
    text-align:center;cursor:pointer;box-shadow:0 1px 4px #0003}
  #inplace-comment-layer .marker.agent{background:#4a7bd4;color:#fff}
  #inplace-comment-layer .marker:focus-visible{outline:2px solid #4a7bd4;outline-offset:2px}
  #inplace-seen-layer .seen{position:fixed;z-index:2147483645;box-sizing:border-box;width:20px;height:20px;display:flex;
    align-items:center;justify-content:center;border-radius:10px;background:#fff;color:#4a7bd4;box-shadow:0 1px 3px #0002;
    opacity:.8;transition:opacity .4s,transform .25s}
  #inplace-seen-layer .seen svg{width:13px;height:13px}
  #inplace-seen-layer .seen[data-mark=done]{color:#2f8a57}
  #inplace-seen-layer .seen.new{opacity:0;transform:scale(.6)}
  #inplace-seen-layer .seen.fading{opacity:0}
  @media (prefers-reduced-motion:reduce){#inplace-seen-layer .seen{transition:none}}
  #inplace-comment-here{all:unset;position:fixed;z-index:2147483646;display:none;padding:3px 9px;border-radius:6px;background:#1f2a24;
    color:#e8ece9;font:12px/1.4 -apple-system,system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px #0003}
  #inplace-comment-here:hover{background:#34433a}
  #inplace-comment-box{position:fixed;z-index:2147483647;display:none;box-sizing:border-box;width:min(320px,calc(100vw - 16px));
    max-height:min(60vh,420px);overflow:auto;padding:10px;border-radius:10px;background:#fff;color:#1f2a24;
    box-shadow:0 10px 32px #0003,0 0 0 1px #0000000f;font:13px/1.45 -apple-system,system-ui,sans-serif;text-align:left}
  #inplace-comment-box.open{display:block}
  #inplace-comment-box textarea,#inplace-changes .comment textarea{box-sizing:border-box;width:100%;min-height:60px;margin:0;padding:6px 8px;
    border:1px solid #cfd6d2;border-radius:6px;background:#fff;color:#1f2a24;font:inherit;resize:vertical}
  #inplace-comment-box .actions{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}
  #inplace-comment-box .actions button{all:unset;padding:5px 10px;border-radius:6px;background:#eef1ef;cursor:pointer}
  #inplace-comment-box .actions button.primary{background:#1f2a24;color:#fff}
  #inplace-comment-box .comment+.comment{margin-top:8px;padding-top:8px;border-top:1px solid #eef1ef}
  #inplace-comment-box p,#inplace-changes .comment p{margin:0 0 4px}
  #inplace-comment-box .quote,#inplace-changes .comment .quote{padding-left:8px;border-left:3px solid #e0a800;color:#56615b}
  #inplace-comment-box .agent .quote,#inplace-changes .comment.agent .quote{border-left-color:#4a7bd4}
  #inplace-comment-box .about,#inplace-changes .comment .about,#inplace-changes .comment .lost{color:#7a8580;font-size:12px}
  #inplace-comment-box .quote.old,#inplace-changes .comment .quote.old{border-left-color:#cfd6d2;text-decoration:line-through}
  #inplace-comment-box .text,#inplace-changes .comment .text{white-space:pre-wrap;overflow-wrap:anywhere}
  #inplace-comment-box .choices,#inplace-changes .comment .choices{display:flex;flex-direction:column;align-items:flex-start;gap:3px;margin:5px 0}
  #inplace-comment-box .choices button,#inplace-changes .comment .choices button{all:unset;box-sizing:border-box;max-width:100%;padding:2px 8px;font-size:12px;
    border:1px solid #b9cbec;border-radius:5px;color:#2d4f8f;cursor:pointer;overflow-wrap:anywhere}
  #inplace-comment-box .choices button:hover,#inplace-changes .comment .choices button:hover{background:#eaf0fb}
  #inplace-comment-box .choices button.own,#inplace-changes .comment .choices button.own{border-color:transparent;color:#7a8580}
  #inplace-comment-box .choices button.own:hover,#inplace-changes .comment .choices button.own:hover{background:none;color:#2d4f8f;text-decoration:underline}
  #inplace-comment-box .choices button:focus-visible,#inplace-changes .comment .choices button:focus-visible{outline:2px solid #4a7bd4;outline-offset:1px}
  #inplace-comment-box .reply,#inplace-changes .comment .reply{color:#56615b}
  #inplace-comment-box .meta,#inplace-changes .comment .meta{display:flex;align-items:baseline;gap:12px;margin-top:6px;font-size:12px;color:#7a8580}
  #inplace-comment-box .meta span,#inplace-changes .comment .meta span{margin-right:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #inplace-comment-box .meta button,#inplace-changes .comment .meta button,#inplace-changes .comments .clear{all:unset;cursor:pointer;
    color:#3d4842;font-weight:500;white-space:nowrap}
  #inplace-comment-box .meta button:hover,#inplace-changes .comment .meta button:hover,#inplace-changes .comments .clear:hover,
    #inplace-comment-box .meta button:focus-visible,#inplace-changes .comment .meta button:focus-visible{color:#1f2a24;text-decoration:underline}
  #inplace-changes .comments{margin:0 0 8px;padding:0 8px 8px;border-bottom:1px solid #eef1ef}
  #inplace-changes .comments h3{all:unset;display:block;margin:4px 0 4px;font-size:12px;font-weight:600;color:#56615b}
  #inplace-changes .comment{padding:6px 0}
  #inplace-changes .comment.goes-to{margin:0 -8px;padding:6px 8px;border-radius:8px;cursor:pointer}
  #inplace-changes .comment.goes-to:hover{background:#f5f7f6}
  #inplace-changes .comment.done{opacity:.6}
  #inplace-changes .comments .clear{display:block;margin-top:4px;font-size:12px}
  #inplace-changes .aside{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:2px 0 8px;padding:9px 11px;
    border-radius:8px;background:#fbefe9;color:#7a2e14}
  #inplace-changes .aside button{all:unset;cursor:pointer;font-weight:600;text-decoration:underline;white-space:nowrap}
  #inplace-changes .entry{padding:9px 0 5px;border-top:1px solid #eef1ef}
  #inplace-changes .entry:first-child{border-top:0}
  #inplace-changes .who{display:flex;align-items:center;gap:6px;padding:0 8px 2px;font-size:12px;font-weight:600}
  #inplace-changes .who .when{margin-left:auto;font-weight:400;color:#7a8580}
  #inplace-changes .who .star{display:block;width:12px;height:12px;color:#9b7bff;filter:drop-shadow(0 0 3px #b39cff88)}
  #inplace-changes .who .star svg{display:block;width:100%;height:100%}
  #inplace-changes ul{all:unset;display:block;list-style:none}
  #inplace-changes li{display:block}
  #inplace-changes .change{all:unset;box-sizing:border-box;display:block;width:100%;padding:5px 8px;border-radius:7px}
  #inplace-changes button.change{cursor:pointer}
  #inplace-changes button.change:hover{background:#f4f1ff}
  #inplace-changes button.change:focus-visible{outline:2px solid #4a7bd4}
  #inplace-changes .kind{display:block;margin-bottom:1px;font-size:11px;color:#7a8580}
  #inplace-changes .text{display:block;overflow-wrap:anywhere}
  #inplace-changes del{padding:0 2px;border-radius:3px;background:#fbe9e3;color:#a1452a;text-decoration:line-through;
    text-decoration-color:#a1452a88}
  #inplace-changes ins{padding:0 2px;border-radius:3px;background:#ece5ff;color:#3d2a85;text-decoration:none}
  #inplace-changes .entry[data-by=you] .who,#inplace-changes .entry[data-by=you] .text{color:#5b6660}
  #inplace-changes .entry[data-by=you] ins{background:#e9eeeb;color:#1f2a24}
  #inplace-changes .access{margin:0 0 8px;padding:9px 11px;border-radius:8px;background:#f1f3f0;color:#3d4a43}
  #inplace-changes .empty{margin:0;padding:4px 8px 10px;color:#7a8580}
  #inplace-changes .review-switch{display:flex;align-items:center;gap:6px;font-size:12px;color:#3d4a43;cursor:pointer;user-select:none}
  #inplace-changes .review-switch input{margin:0;accent-color:#6a52c9}
  #inplace-changes .authors-switch{display:flex;align-items:center;gap:6px;font-size:12px;color:#3d4a43;cursor:pointer;user-select:none}
  #inplace-changes .authors-switch input{margin:0;accent-color:#3f8f5c}
  #inplace-authors-layer{position:absolute;top:0;left:0;width:0;height:0;z-index:2147483644}
  #inplace-authors-layer .bar{position:absolute;width:10px;cursor:default;pointer-events:auto}
  #inplace-authors-layer .bar::after{content:"";position:absolute;left:3px;top:0;bottom:0;width:3px;border-radius:2px;background:var(--by)}
  html.inplace-reviewing #inplace-authors-layer{display:none}
  #inplace-pending-layer{position:absolute;top:0;left:0;width:0;height:0;z-index:2147483644}
  #inplace-pending-layer .bar{position:absolute;width:10px;cursor:default;pointer-events:auto}
  #inplace-pending-layer .bar::after{content:"";position:absolute;left:3px;top:0;bottom:0;width:3px;border-radius:2px;background:#4a7bd4}
  #inplace-pending-actions{position:absolute;z-index:2147483646;display:none;gap:2px;padding:2px;border-radius:7px;background:#fff;
    box-shadow:0 1px 4px #0002,0 0 0 1px #d9e0dc;font:12px/1.2 -apple-system,system-ui,sans-serif}
  #inplace-pending-actions button{all:unset;padding:3px 9px;border-radius:5px;cursor:pointer;color:#1f2a24;font-weight:600}
  #inplace-pending-actions button:hover{background:#eaf0fb}
  #inplace-pending-actions button:focus-visible{outline:2px solid #4a7bd4}
  #inplace-pending-actions button:disabled{color:#a0a8a4;cursor:default;background:none}
  html.inplace-reviewing #inplace-pending-layer,html.inplace-reviewing #inplace-pending-actions{display:none!important}
  #inplace-changes .to-review{margin:0 0 8px;padding:0 0 8px;border-bottom:1px solid #eef1ef}
  #inplace-changes .to-review .head{display:flex;align-items:center;gap:8px;padding:0 8px 4px}
  #inplace-changes .to-review h3{all:unset;margin-right:auto;font-size:12px;font-weight:600;color:#56615b}
  #inplace-changes .to-review li{position:relative}
  #inplace-changes .to-review .kind{padding-right:104px;line-height:20px}
  #inplace-changes .to-review .acts{position:absolute;top:5px;right:8px;display:flex;gap:4px}
  #inplace-changes .to-review .keep-all,#inplace-changes .to-review .act{all:unset;flex:none;padding:1px 9px;border-radius:6px;cursor:pointer;
    font-size:12px;line-height:16px;font-weight:500;color:#1f2a24;background:#fff;box-shadow:inset 0 0 0 1px #d4dad6}
  #inplace-changes .to-review .keep-all{background:#4a7bd4;color:#fff;box-shadow:none}
  #inplace-changes .to-review .keep-all:hover{background:#3d6bc0}
  #inplace-changes .to-review .act:hover{background:#f1f4f2}
  #inplace-changes .to-review .keep-all:focus-visible,#inplace-changes .to-review .act:focus-visible{outline:2px solid #4a7bd4;outline-offset:1px}
  #inplace-changes .to-review .act:disabled{color:#a0a8a4;cursor:default;background:#fff}
  #inplace-review-bar{position:fixed;top:0;left:0;right:0;z-index:2147483647;display:flex;flex-wrap:wrap;align-items:center;
    gap:6px 16px;padding:9px 16px;background:#1f2a24;color:#fff;font:13px/1.35 -apple-system,system-ui,sans-serif;
    box-shadow:0 2px 10px #0003}
  #inplace-review-bar .what{flex:1 1 260px}
  #inplace-review-bar label{display:flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap}
  #inplace-review-bar label input{margin:0;accent-color:#b39cff}
  #inplace-review-bar button{all:unset;padding:4px 12px;border-radius:6px;background:#fff;color:#1f2a24;font-weight:600;cursor:pointer}
  #inplace-review-bar button:focus-visible{outline:2px solid #b39cff}
  #inplace-review-bar .removed{flex-basis:100%;margin:0;color:#d5dcd8}
  #inplace-review-bar .removed del{color:#f3c3b3}
  html.inplace-reviewing [data-id][contenteditable]{box-shadow:none!important}
  #inplace-review-layer{position:absolute;top:0;left:0;width:0;height:0;z-index:2147483645}
  .inplace-review-label{position:absolute;display:flex;flex-direction:column;align-items:flex-end;padding:1px 6px;border-radius:5px;
    background:#ece5ff;color:#3d2a85;font:11px/1.45 -apple-system,system-ui,sans-serif;white-space:nowrap;pointer-events:none}
  ins.inplace-ins{background:#ece5ff;color:#3d2a85;text-decoration:none;border-radius:2px;
    -webkit-print-color-adjust:exact;print-color-adjust:exact}
  del.inplace-del{background:#fbe9e3;color:#a1452a;text-decoration:line-through;text-decoration-color:#a1452a99;border-radius:2px;
    -webkit-print-color-adjust:exact;print-color-adjust:exact}
  .inplace-ghost{opacity:.85}
  .inplace-ghost td{text-align:start}
  ol > li.inplace-ghost{display:block}
  [data-id].inplace-review-new{background-color:#c4b2ff38!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  @media print{#inplace-review-bar,#inplace-review-spacer,#inplace-review-layer,#inplace-authors-layer,#inplace-pending-layer,#inplace-pending-actions{display:none!important}}
  #inplace-changes li.undoable{display:flex;align-items:flex-start}
  #inplace-changes .undo{all:unset;flex:none;margin:5px 4px 0;padding:0 6px;border-radius:5px;cursor:pointer;font-size:12px;
    font-weight:600;color:#3d2a85;text-decoration:underline}
  #inplace-changes .undo:hover{background:#f4f1ff}
  #inplace-changes .undo:focus-visible{outline:2px solid #4a7bd4}
  #inplace-stash{position:fixed;inset:0;z-index:2147483647;display:none;align-items:flex-start;justify-content:center;
    padding:48px 16px;background:#1f2a2466;overflow:auto;font:14px/1.45 -apple-system,system-ui,sans-serif;color:#1f2a24}
  #inplace-stash.open{display:flex}
  #inplace-stash .panel{box-sizing:border-box;width:min(760px,100%);background:#fff;border-radius:10px;padding:20px 22px;
    box-shadow:0 12px 40px #0004}
  #inplace-stash h2{all:unset;display:block;font-size:17px;font-weight:600;margin:0 0 4px}
  #inplace-stash .intro{margin:0 0 14px;color:#5b6660}
  #inplace-stash .entry{border-top:1px solid #e4e8e5;padding:14px 0}
  #inplace-stash .cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  @media (max-width:560px){#inplace-stash .cols{grid-template-columns:1fr}}
  #inplace-stash .col h3{all:unset;display:block;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;
    color:#7a8580;margin-bottom:4px}
  #inplace-stash .col div{white-space:pre-wrap;background:#f4f6f5;border-radius:6px;padding:8px 10px;max-height:220px;overflow:auto}
  #inplace-stash .mine div{background:#fbefe9}
  #inplace-stash .note{margin:10px 0 0;color:#9c3b1c}
  #inplace-stash .actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  #inplace-stash button{all:unset;box-sizing:border-box;padding:6px 11px;border-radius:6px;background:#eef1ef;cursor:pointer;
    font:13px/1.2 -apple-system,system-ui,sans-serif;color:#1f2a24}
  #inplace-stash button:hover{background:#e0e5e2}
  #inplace-stash button.primary{background:#1f2a24;color:#fff}
  #inplace-stash button.primary:hover{background:#34433a}
  #inplace-stash .close{float:right}
  @media print{#inplace-status,#inplace-ui,#inplace-toolbar,#inplace-stash,#inplace-corner,#inplace-changes,#inplace-comment-layer,#inplace-seen-layer,#inplace-comment-box,#inplace-comment-here{display:none!important}::highlight(inplace-comment),::highlight(inplace-agent-comment){background-color:transparent}[data-id][contenteditable]{box-shadow:none!important}.inplace-sparkle{display:none!important}
    [data-id].inplace-changed,[data-id].inplace-changed-fade{background-color:transparent!important;animation:none!important}}`;
document.head.append(style);
