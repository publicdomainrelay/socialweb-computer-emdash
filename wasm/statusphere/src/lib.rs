use atproto_record::datetime::Datetime;
use atproto_record::typed::{LexiconType, TypedLexicon};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const COLLECTION: &str = "xyz.statusphere.status";
const CLEAR_LIMIT: usize = 10;

#[derive(Deserialize)]
struct Step {
    did: String,
    now: String,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    state: Value,
    #[serde(default)]
    results: Vec<CallResult>,
}

#[derive(Deserialize)]
struct CallResult {
    ok: bool,
    #[serde(default)]
    output: Value,
    #[serde(default)]
    error: Option<String>,
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

fn parse(input: &[u8]) -> Result<Step, String> {
    let step: Step = serde_json::from_slice(input).map_err(|e| format!("invalid input: {e}"))?;
    if !step.did.starts_with("did:") {
        return Err("did must start with did:".into());
    }
    Ok(step)
}

fn validate_status(status: Option<&str>) -> Result<String, String> {
    let status = status.unwrap_or_default();
    if status.is_empty() || status.len() > 32 {
        return Err("status must be 1 to 32 bytes".into());
    }
    if status.chars().any(char::is_control) {
        return Err("status must not contain control characters".into());
    }
    Ok(status.to_string())
}

fn first_result(step: &Step) -> Result<&Value, String> {
    let result = step.results.first().ok_or("missing call result")?;
    if !result.ok {
        return Err(result.error.clone().unwrap_or_else(|| "call failed".into()));
    }
    Ok(&result.output)
}

fn list_statuses(did: &str, limit: usize) -> Value {
    json!({
        "nsid": "com.atproto.repo.listRecords",
        "params": { "repo": did, "collection": COLLECTION, "limit": limit.to_string() },
    })
}

fn set_status_step(step: Step) -> Result<Value, String> {
    let status = validate_status(step.status.as_deref())?;
    Datetime::new(step.now.clone()).map_err(|e| format!("invalid now: {e}"))?;
    Ok(json!({
        "calls": [list_statuses(&step.did, 1)],
        "next": "set_status_write",
        "state": { "status": status },
    }))
}

fn set_status_write_step(step: Step) -> Result<Value, String> {
    let status = validate_status(step.state["status"].as_str())?;
    let latest = &first_result(&step)?["records"][0];
    if latest["value"]["status"].as_str() == Some(status.as_str()) {
        return Ok(json!({
            "calls": [],
            "result": { "status": status, "unchanged": true, "uri": latest["uri"] },
        }));
    }
    let now = Datetime::new(step.now).map_err(|e| format!("invalid now: {e}"))?;
    let created_at = Datetime::try_from(now.to_utc()).map_err(|e| format!("invalid now: {e}"))?;
    let record = TypedLexicon::new(Status {
        status: status.clone(),
        created_at,
    });
    Ok(json!({
        "calls": [{
            "nsid": "com.atproto.repo.createRecord",
            "input": { "repo": step.did, "collection": COLLECTION, "record": record },
        }],
        "next": "set_status_done",
        "state": { "status": status },
    }))
}

fn set_status_done_step(step: Step) -> Result<Value, String> {
    let created = first_result(&step)?;
    Ok(json!({
        "calls": [],
        "result": { "status": step.state["status"], "unchanged": false, "uri": created["uri"] },
    }))
}

fn clear_status_step(step: Step) -> Result<Value, String> {
    Ok(json!({
        "calls": [list_statuses(&step.did, CLEAR_LIMIT)],
        "next": "clear_status_delete",
    }))
}

fn clear_status_delete_step(step: Step) -> Result<Value, String> {
    let records = first_result(&step)?["records"].as_array().cloned().unwrap_or_default();
    let calls: Vec<Value> = records
        .iter()
        .filter_map(|record| record["uri"].as_str()?.rsplit('/').next().map(str::to_string))
        .take(CLEAR_LIMIT)
        .map(|rkey| {
            json!({
                "nsid": "com.atproto.repo.deleteRecord",
                "input": { "repo": step.did, "collection": COLLECTION, "rkey": rkey },
            })
        })
        .collect();
    if calls.is_empty() {
        return Ok(json!({ "calls": [], "result": { "deleted": 0 } }));
    }
    Ok(json!({ "calls": calls, "next": "clear_status_done" }))
}

fn clear_status_done_step(step: Step) -> Result<Value, String> {
    let deleted = step.results.iter().filter(|result| result.ok).count();
    let failed = step.results.len() - deleted;
    Ok(json!({ "calls": [], "result": { "deleted": deleted, "failed": failed } }))
}

fn leak(bytes: Vec<u8>) -> i64 {
    let bytes = bytes.leak();
    ((bytes.as_ptr() as u32 as i64) << 32) | bytes.len() as u32 as i64
}

fn respond(ptr: i32, len: i32, step: fn(Step) -> Result<Value, String>) -> i64 {
    let input = unsafe { core::slice::from_raw_parts(ptr as *const u8, len.max(0) as usize) };
    let output = parse(input)
        .and_then(step)
        .unwrap_or_else(|error| json!({ "error": error }));
    leak(serde_json::to_vec(&output).unwrap_or_default())
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: i32) -> i32 {
    Vec::<u8>::with_capacity(len.max(0) as usize).leak().as_mut_ptr() as i32
}

macro_rules! entries {
    ($($name:ident => $step:ident),*) => {
        $(
            #[unsafe(no_mangle)]
            pub extern "C" fn $name(ptr: i32, len: i32) -> i64 {
                respond(ptr, len, $step)
            }
        )*
    };
}

entries!(
    set_status => set_status_step,
    set_status_write => set_status_write_step,
    set_status_done => set_status_done_step,
    clear_status => clear_status_step,
    clear_status_delete => clear_status_delete_step,
    clear_status_done => clear_status_done_step
);
