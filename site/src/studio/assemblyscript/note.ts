import { Json, call, done, fail, input, next } from "./abi";
export { alloc } from "./abi";

const COLLECTION = "com.example.note";

export function note(ptr: usize, len: i32): i64 {
  const step = input(ptr, len);
  const text = step.get("text").str;
  if (text.length == 0) return fail("text is required");
  const record = Json.object()
    .set("$type", Json.string(COLLECTION))
    .set("text", Json.string(text))
    .set("createdAt", step.get("now"));
  const create = call(
    "com.atproto.repo.createRecord",
    Json.object().set("repo", step.get("did")).set("collection", Json.string(COLLECTION)).set("record", record),
  );
  return next([create], "note_done");
}

export function note_done(ptr: usize, len: i32): i64 {
  const result = input(ptr, len).get("results").at(0);
  if (!result.get("ok").bool) return fail(result.get("error").str);
  const created = result.get("output");
  return done(Json.object().set("uri", created.get("uri")).set("cid", created.get("cid")));
}
