use abi::{CallResult, Did, entries, first_output};
use atproto_record::datetime::Datetime;
use atproto_record::typed::{LexiconType, TypedLexicon};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use unicode_segmentation::UnicodeSegmentation;

const COLLECTION: &str = "com.vibescrobble.scrobble";
const MAX_GRAPHEMES: usize = 256;
const MAX_BYTES: usize = 2560;
const MAX_TASK_BYTES: usize = 256;

#[derive(Deserialize)]
struct Step {
    did: Did,
    now: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    task: Option<String>,
    #[serde(default)]
    results: Vec<CallResult>,
}

#[derive(Serialize, PartialEq)]
struct Scrobble {
    text: String,
    emoji: String,
    #[serde(rename = "createdAt")]
    created_at: Datetime,
    #[serde(skip_serializing_if = "Option::is_none")]
    task: Option<String>,
}

impl LexiconType for Scrobble {
    fn lexicon_type() -> &'static str {
        COLLECTION
    }
}

fn leading_emoji(text: &str) -> Option<&str> {
    let first = text.graphemes(true).next()?;
    let c = first.chars().next()? as u32;
    let emoji = matches!(c, 0x1F000..=0x1FAFF)
        || first.contains('\u{FE0F}')
        || first.contains('\u{20E3}')
        || emoji_presentation_bmp(c);
    emoji.then_some(first)
}

fn emoji_presentation_bmp(c: u32) -> bool {
    matches!(
        c,
        0x231A..=0x231B
            | 0x23E9..=0x23EC
            | 0x23F0
            | 0x23F3
            | 0x25FD..=0x25FE
            | 0x2614..=0x2615
            | 0x2648..=0x2653
            | 0x267F
            | 0x2693
            | 0x26A1
            | 0x26AA..=0x26AB
            | 0x26BD..=0x26BE
            | 0x26C4..=0x26C5
            | 0x26CE
            | 0x26D4
            | 0x26EA
            | 0x26F2..=0x26F3
            | 0x26F5
            | 0x26FA
            | 0x26FD
            | 0x2705
            | 0x270A..=0x270B
            | 0x2728
            | 0x274C
            | 0x274E
            | 0x2753..=0x2755
            | 0x2757
            | 0x2795..=0x2797
            | 0x27B0
            | 0x27BF
            | 0x2B1B..=0x2B1C
            | 0x2B50
            | 0x2B55
    )
}

fn truncate(text: &str) -> String {
    let mut out = String::new();
    for grapheme in text.graphemes(true).take(MAX_GRAPHEMES) {
        if out.len() + grapheme.len() > MAX_BYTES {
            break;
        }
        out.push_str(grapheme);
    }
    out
}

fn validate_task(task: Option<String>) -> Result<Option<String>, String> {
    let Some(task) = task.filter(|task| !task.is_empty()) else {
        return Ok(None);
    };
    if task.len() > MAX_TASK_BYTES || task.chars().any(char::is_control) {
        return Err(format!("task must be at most {MAX_TASK_BYTES} bytes without control characters"));
    }
    Ok(Some(task))
}

fn scrobble_step(step: Step) -> Result<Value, String> {
    let text = step.text.unwrap_or_default();
    let emoji = leading_emoji(&text).ok_or("text must start with an emoji")?.to_string();
    let now = Datetime::new(step.now).map_err(|e| format!("invalid now: {e}"))?;
    let created_at = Datetime::try_from(now.to_utc()).map_err(|e| format!("invalid now: {e}"))?;
    let record = TypedLexicon::new(Scrobble {
        text: truncate(&text),
        emoji,
        created_at,
        task: validate_task(step.task)?,
    });
    Ok(json!({
        "calls": [{
            "nsid": "com.atproto.repo.createRecord",
            "input": { "repo": step.did, "collection": COLLECTION, "record": record, "validate": false },
        }],
        "next": "scrobble_done",
    }))
}

fn scrobble_done_step(step: Step) -> Result<Value, String> {
    let created = first_output(&step.results)?;
    Ok(json!({ "calls": [], "result": { "uri": created["uri"], "cid": created["cid"] } }))
}

entries!(
    scrobble => scrobble_step,
    scrobble_done => scrobble_done_step,
);
