export enum Kind {
  Null,
  Bool,
  Number,
  String,
  Array,
  Object,
}

export class Json {
  kind: Kind = Kind.Null;
  bool: bool = false;
  num: f64 = 0;
  str: string = "";
  items: Json[] = [];
  keys: string[] = [];
  values: Json[] = [];

  static null(): Json {
    return new Json();
  }

  static bool(value: bool): Json {
    const json = new Json();
    json.kind = Kind.Bool;
    json.bool = value;
    return json;
  }

  static number(value: f64): Json {
    const json = new Json();
    json.kind = Kind.Number;
    json.num = value;
    return json;
  }

  static string(value: string): Json {
    const json = new Json();
    json.kind = Kind.String;
    json.str = value;
    return json;
  }

  static array(items: Json[]): Json {
    const json = new Json();
    json.kind = Kind.Array;
    json.items = items;
    return json;
  }

  static object(): Json {
    const json = new Json();
    json.kind = Kind.Object;
    return json;
  }

  static parse(text: string): Json {
    const parser = new Parser(text);
    const value = parser.value();
    parser.space();
    if (parser.at < text.length) throw new Error("trailing characters in JSON");
    return value;
  }

  get isNull(): bool {
    return this.kind == Kind.Null;
  }

  get(key: string): Json {
    for (let i = 0; i < this.keys.length; i++) if (this.keys[i] == key) return this.values[i];
    return new Json();
  }

  at(index: i32): Json {
    return index >= 0 && index < this.items.length ? this.items[index] : new Json();
  }

  set(key: string, value: Json): Json {
    for (let i = 0; i < this.keys.length; i++) {
      if (this.keys[i] == key) {
        this.values[i] = value;
        return this;
      }
    }
    this.keys.push(key);
    this.values.push(value);
    return this;
  }

  push(value: Json): Json {
    this.items.push(value);
    return this;
  }

  toString(): string {
    switch (this.kind) {
      case Kind.Bool:
        return this.bool ? "true" : "false";
      case Kind.Number:
        return isFinite(this.num) ? (this.num == Math.floor(this.num) && Math.abs(this.num) < 9007199254740992 ? i64(this.num).toString() : this.num.toString()) : "null";
      case Kind.String:
        return quote(this.str);
      case Kind.Array: {
        const parts = new Array<string>(this.items.length);
        for (let i = 0; i < this.items.length; i++) parts[i] = this.items[i].toString();
        return "[" + parts.join(",") + "]";
      }
      case Kind.Object: {
        const parts = new Array<string>(this.keys.length);
        for (let i = 0; i < this.keys.length; i++) parts[i] = quote(this.keys[i]) + ":" + this.values[i].toString();
        return "{" + parts.join(",") + "}";
      }
      default:
        return "null";
    }
  }
}

function quote(value: string): string {
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code == 0x22) out += '\\"';
    else if (code == 0x5c) out += "\\\\";
    else if (code == 0x0a) out += "\\n";
    else if (code == 0x0d) out += "\\r";
    else if (code == 0x09) out += "\\t";
    else if (code < 0x20) out += "\\u" + code.toString(16).padStart(4, "0");
    else out += String.fromCharCode(code);
  }
  return out + '"';
}

class Parser {
  at: i32 = 0;

  constructor(public text: string) {}

  space(): void {
    while (this.at < this.text.length) {
      const code = this.text.charCodeAt(this.at);
      if (code != 0x20 && code != 0x0a && code != 0x0d && code != 0x09) return;
      this.at++;
    }
  }

  expect(word: string): void {
    if (this.text.substr(this.at, word.length) != word) throw new Error("invalid JSON at " + this.at.toString());
    this.at += word.length;
  }

  value(): Json {
    this.space();
    if (this.at >= this.text.length) throw new Error("unexpected end of JSON");
    const code = this.text.charCodeAt(this.at);
    if (code == 0x7b) return this.object();
    if (code == 0x5b) return this.array();
    if (code == 0x22) return Json.string(this.string());
    if (code == 0x74) {
      this.expect("true");
      return Json.bool(true);
    }
    if (code == 0x66) {
      this.expect("false");
      return Json.bool(false);
    }
    if (code == 0x6e) {
      this.expect("null");
      return Json.null();
    }
    return this.number();
  }

  take(code: i32): bool {
    this.space();
    if (this.at < this.text.length && this.text.charCodeAt(this.at) == code) {
      this.at++;
      return true;
    }
    return false;
  }

  object(): Json {
    const json = Json.object();
    this.at++;
    if (this.take(0x7d)) return json;
    do {
      this.space();
      const key = this.string();
      this.space();
      this.expect(":");
      json.set(key, this.value());
    } while (this.take(0x2c));
    this.space();
    this.expect("}");
    return json;
  }

  array(): Json {
    const json = Json.array([]);
    this.at++;
    if (this.take(0x5d)) return json;
    do {
      json.push(this.value());
    } while (this.take(0x2c));
    this.space();
    this.expect("]");
    return json;
  }

  string(): string {
    this.expect('"');
    let out = "";
    while (this.at < this.text.length) {
      const code = this.text.charCodeAt(this.at++);
      if (code == 0x22) return out;
      if (code != 0x5c) {
        out += String.fromCharCode(code);
        continue;
      }
      const escape = this.text.charCodeAt(this.at++);
      if (escape == 0x6e) out += "\n";
      else if (escape == 0x72) out += "\r";
      else if (escape == 0x74) out += "\t";
      else if (escape == 0x62) out += "\b";
      else if (escape == 0x66) out += "\f";
      else if (escape == 0x75) {
        out += String.fromCharCode(<i32>parseInt(this.text.substr(this.at, 4), 16));
        this.at += 4;
      } else out += String.fromCharCode(escape);
    }
    throw new Error("unterminated string in JSON");
  }

  number(): Json {
    const start = this.at;
    while (this.at < this.text.length) {
      const code = this.text.charCodeAt(this.at);
      if ((code >= 0x30 && code <= 0x39) || code == 0x2d || code == 0x2b || code == 0x2e || code == 0x65 || code == 0x45) this.at++;
      else break;
    }
    if (start == this.at) throw new Error("invalid JSON at " + start.toString());
    return Json.number(parseFloat(this.text.substring(start, this.at)));
  }
}

export function alloc(len: i32): usize {
  return heap.alloc(<usize>len);
}

export function input(ptr: usize, len: i32): Json {
  return Json.parse(String.UTF8.decodeUnsafe(ptr, <usize>len));
}

export function output(value: Json): i64 {
  const bytes = String.UTF8.encode(value.toString());
  return (i64(changetype<usize>(bytes)) << 32) | i64(bytes.byteLength);
}

export function fail(message: string): i64 {
  return output(Json.object().set("error", Json.string(message)));
}

export function call(nsid: string, input: Json): Json {
  return Json.object().set("nsid", Json.string(nsid)).set("input", input);
}

export function query(nsid: string, params: Json): Json {
  return Json.object().set("nsid", Json.string(nsid)).set("params", params);
}

export function done(result: Json): i64 {
  return output(Json.object().set("calls", Json.array([])).set("result", result));
}

export function next(calls: Json[], entry: string): i64 {
  return output(Json.object().set("calls", Json.array(calls)).set("next", Json.string(entry)));
}
