import { done, input } from "./abi";
export { alloc } from "./abi";

export function echo(ptr: usize, len: i32): i64 {
  return done(input(ptr, len));
}
