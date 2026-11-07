use atproto_record::datetime::Datetime;
use atproto_record::typed::{LexiconType, TypedLexicon};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const COLLECTION: &str = "xyz.statusphere.status";

#[derive(Deserialize)]
struct Input {
    status: String,
    now: String,
    did: String,
}

#[derive(Serialize, PartialEq)]
struct Status {
    status: String,
    #[serde(rename = "createdAt")]
    created_at: Datetime,
}

impl LexiconType for Status {
    fn lexicon_type() -> &'static str {
        COLLECTION
    }
}

fn set_status_json(input: &[u8]) -> Result<Value, String> {
    let input: Input = serde_json::from_slice(input).map_err(|e| format!("invalid input: {e}"))?;
    if input.status.is_empty() || input.status.len() > 32 {
        return Err("status must be 1 to 32 bytes".into());
    }
    if input.status.chars().any(char::is_control) {
        return Err("status must not contain control characters".into());
    }
    if !input.did.starts_with("did:") {
        return Err("did must start with did:".into());
    }
    let now = Datetime::new(input.now).map_err(|e| format!("invalid now: {e}"))?;
    let created_at = Datetime::try_from(now.to_utc()).map_err(|e| format!("invalid now: {e}"))?;
    let record = TypedLexicon::new(Status {
        status: input.status,
        created_at,
    });
    Ok(json!({
        "calls": [{
            "nsid": "com.atproto.repo.createRecord",
            "input": {
                "repo": input.did,
                "collection": COLLECTION,
                "record": record,
            },
        }],
    }))
}

fn leak(bytes: Vec<u8>) -> i64 {
    let bytes = bytes.leak();
    ((bytes.as_ptr() as u32 as i64) << 32) | bytes.len() as u32 as i64
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: i32) -> i32 {
    Vec::<u8>::with_capacity(len.max(0) as usize).leak().as_mut_ptr() as i32
}

#[unsafe(no_mangle)]
pub extern "C" fn set_status(ptr: i32, len: i32) -> i64 {
    let input = unsafe { core::slice::from_raw_parts(ptr as *const u8, len.max(0) as usize) };
    let output = set_status_json(input).unwrap_or_else(|error| json!({ "error": error }));
    leak(serde_json::to_vec(&output).unwrap_or_default())
}
