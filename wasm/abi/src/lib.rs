use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Deserialize, Serialize)]
#[serde(try_from = "String")]
pub struct Did(String);

impl TryFrom<String> for Did {
    type Error = String;

    fn try_from(value: String) -> Result<Self, String> {
        if value.starts_with("did:") {
            Ok(Self(value))
        } else {
            Err("did must start with did:".into())
        }
    }
}

#[derive(Deserialize)]
pub struct CallResult {
    ok: bool,
    #[serde(default)]
    output: Value,
    #[serde(default)]
    error: Option<String>,
}

impl CallResult {
    pub fn output(&self) -> Result<&Value, String> {
        if self.ok {
            Ok(&self.output)
        } else {
            Err(self.error.clone().unwrap_or_else(|| "call failed".into()))
        }
    }

    pub fn ok(&self) -> bool {
        self.ok
    }
}

pub fn first_output(results: &[CallResult]) -> Result<&Value, String> {
    results.first().ok_or("missing call result")?.output()
}

fn leak(bytes: Vec<u8>) -> i64 {
    let bytes = bytes.leak();
    ((bytes.as_ptr() as u32 as i64) << 32) | bytes.len() as u32 as i64
}

pub fn respond<T: DeserializeOwned>(ptr: i32, len: i32, step: fn(T) -> Result<Value, String>) -> i64 {
    let input = unsafe { core::slice::from_raw_parts(ptr as *const u8, len.max(0) as usize) };
    let output = serde_json::from_slice(input)
        .map_err(|e| format!("invalid input: {e}"))
        .and_then(step)
        .unwrap_or_else(|error| json!({ "error": error }));
    leak(serde_json::to_vec(&output).unwrap_or_default())
}

pub fn alloc(len: i32) -> i32 {
    Vec::<u8>::with_capacity(len.max(0) as usize).leak().as_mut_ptr() as i32
}

#[macro_export]
macro_rules! entries {
    ($($name:ident => $step:ident),* $(,)?) => {
        #[unsafe(no_mangle)]
        pub extern "C" fn alloc(len: i32) -> i32 {
            $crate::alloc(len)
        }

        $(
            #[unsafe(no_mangle)]
            pub extern "C" fn $name(ptr: i32, len: i32) -> i64 {
                $crate::respond(ptr, len, $step)
            }
        )*
    };
}
