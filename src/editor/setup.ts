// The <script> tag the server added to the page, with what it knows about the document.
const script = document.currentScript as HTMLScriptElement;
let version = script.dataset.version;
const STATE_KEY = `inplace:${script.dataset.file}`;
// What this person may do here: "edit" the text, only "comment", or only read ("view").
// The server enforces it; the page just doesn't offer what would be refused.
const access = script.dataset.access || "edit";
const canEdit = access === "edit";
const canComment = access !== "view";
const SAVE_DELAY = 600;
const INLINE_OK = new Set(["A", "B", "STRONG", "I", "EM", "U", "S", "SUB", "SUP", "SPAN", "BR", "CODE", "SMALL", "MARK", "ABBR", "TIME"]);
