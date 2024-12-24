const std = @import("std");
const MemoryPool = std.heap.MemoryPool;

// zig build -Doptimize=ReleaseFast run -- ../save_no_meta.txt 'ssss' '(4 1 2 2 6 SPACE SPACE SPACE 6 9 1 9 0 NEWLINE 8 9 3 1 8 SPACE SPACE SPACE 1 0 1 0 0 NEWLINE 5 9 4 1 9 SPACE SPACE SPACE 2 3 8 8 0 NEWLINE)'

// TODO: bug when the fnk name is a pair, it gets 0 cases

// Design decision 1: strings live on the input buffer

// const max_inlined_len = 12;
// const Atom = union(enum) {
//     inlined: struct {
//         len: u8,
//         val: [max_inlined_len]u8,
//     },
//     interned: []const u8,
// };
const Atom = struct {
    value: []const u8,

    pub fn lit(v: []const u8) Atom {
        return .{ .value = v };
    }

    pub fn equals(this: Atom, other: Atom) bool {
        return std.mem.eql(u8, this.value, other.value);
    }

    pub fn isVar(this: Atom) bool {
        return this.value.len > 1 and this.value[0] == '@';
    }
};
const Pair = struct {
    left: *const Sexpr,
    right: *const Sexpr,
};
const Sexpr = union(enum) {
    atom: Atom,
    pair: Pair,

    const @"var" = Sexpr{ .atom = Atom.lit("var") };
    const atom = Sexpr{ .atom = Atom.lit("atom") };
    const nil = Sexpr{ .atom = Atom.lit("nil") };
    const identity = Sexpr{ .atom = Atom.lit("identity") };
    const @"eqAtoms?" = Sexpr{ .atom = Atom.lit("eqAtoms?") };
    const @"true" = Sexpr{ .atom = Atom.lit("true") };
    const @"false" = Sexpr{ .atom = Atom.lit("false") };

    pub fn equals(this: Sexpr, other: Sexpr) bool {
        return switch (this) {
            .atom => |this_atom| switch (other) {
                .atom => |other_atom| this_atom.equals(other_atom),
                .pair => false,
            },
            .pair => |this_pair| switch (other) {
                .atom => false,
                .pair => |other_pair| this_pair.left.equals(other_pair.left.*) and this_pair.right.equals(other_pair.right.*),
            },
        };
    }

    pub fn isAtom(this: Sexpr) bool {
        return switch (this) {
            .atom => true,
            .pair => false,
        };
    }

    pub fn fromBool(b: bool) Sexpr {
        return if (b) Sexpr.true else Sexpr.false;
    }
};

const InnerCases = std.ArrayListUnmanaged(MatchCaseDefinition);
const MatchCaseDefinition = struct {
    pattern: Sexpr,
    fn_name: Sexpr,
    template: Sexpr,
    next: ?InnerCases,
};

// const Bindings = std.StringArrayHashMap(*const Sexpr);
const Binding = struct {
    name: []const u8,
    value: *const Sexpr,
};
const Bindings = std.ArrayList(Binding);

const Fnk = struct { name: Sexpr, body: FnkBody };

const FnkBody = struct {
    cases: InnerCases,
    arena: std.heap.ArenaAllocator,
};

const FnkCollection = std.ArrayHashMap(Sexpr, FnkBody, struct {
    pub fn hash(self: @This(), s: Sexpr) u32 {
        return switch (s) {
            .atom => |a| std.array_hash_map.hashString(a.value),
            .pair => |p| {
                // return std.hash.uint32(hash(self, p.left.*)) ^ hash(self, p.right.*);
                var hasher = std.hash.Wyhash.init(0);
                std.hash.autoHash(&hasher, struct {
                    left: u32,
                    right: u32,
                }{ .left = hash(self, p.left.*), .right = hash(self, p.right.*) });
                return @truncate(hasher.final());
            },
        };
    }
    pub fn eql(self: @This(), a: Sexpr, b: Sexpr, b_index: usize) bool {
        _ = self;
        _ = b_index;
        return Sexpr.equals(a, b);
    }
}, true);

pub fn main() !void {
    const stdout_file = std.io.getStdOut().writer();
    var bw = std.io.bufferedWriter(stdout_file);
    defer {
        bw.flush() catch std.debug.panic("flush failed!", .{});
    }

    const stdout = bw.writer();

    try stdout.print("@sizeOf(Pair): {d}\n", .{@sizeOf(Pair)});
    try stdout.print("@sizeOf(Atom): {d}\n", .{@sizeOf(Atom)});
    try stdout.print("@sizeOf(Sexpr): {d}\n", .{@sizeOf(Sexpr)});

    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer {
        const deinit_status = gpa.deinit();
        if (deinit_status == .leak) std.debug.panic("leaked memory!", .{});
    }
    const allocator = gpa.allocator();

    // const allocator = std.heap.wasm_allocator;

    var temp_allocator_instance = std.heap.ArenaAllocator.init(allocator);
    defer temp_allocator_instance.deinit();
    const temp_allocator = temp_allocator_instance.allocator();

    var pool = MemoryPool(Sexpr).init(allocator);
    defer pool.deinit();

    var args = try std.process.argsWithAllocator(allocator);
    defer args.deinit();

    _ = args.next().?;
    const save_file_name = args.next().?;
    var fn_name_raw = args.next().?;
    var input_raw = args.next().?;

    const fn_name = try parseSexpr(&fn_name_raw, &pool);
    const input = try parseSexpr(&input_raw, &pool);

    try stdout.print("fn name: ", .{});
    try writeSexpr(fn_name, stdout.any(), temp_allocator);
    try stdout.print("\n", .{});

    try stdout.print("input: ", .{});
    try writeSexpr(input, stdout.any(), temp_allocator);
    try stdout.print("\n", .{});

    var fnk_collection = FnkCollection.init(allocator);
    defer fnk_collection.deinit();

    const save_file = try std.fs.cwd().openFile(save_file_name, .{});
    defer save_file.close();

    const save_input: []const u8 = try save_file.readToEndAlloc(allocator, std.math.maxInt(usize));
    defer allocator.free(save_input);

    var remaining_fnk_input = save_input;
    while (true) {
        skipWhitespace(&remaining_fnk_input);
        if (remaining_fnk_input.len == 0) break;
        const fnk = try parseFnk(&remaining_fnk_input, &pool, allocator);
        try fnk_collection.put(fnk.name, fnk.body);
    }
    defer {
        for (fnk_collection.values()) |fnk| {
            fnk.arena.deinit();
        }
    }

    const result = try applyFnk(&fnk_collection, fn_name, &input, temp_allocator, &pool, allocator);
    try stdout.print("result: ", .{});
    try writeSexpr(result, stdout.any(), temp_allocator);
    try stdout.print("\n", .{});

    // while (args.next()) |arg| {
    //     try stdout.print("arg: {s}\n", .{arg});
    //     std.fs.cwd().openFile(arg, flags: File.OpenFlags)
    // }
    // defer args.deinit();
    // _ = args.skip();
    // while (args.next()) |arg| {
    //     var reader = std.io.fixedBufferStream.Reader.init(arg);
    //     parseSexpr(allocator, reader);
    //     try stdout.print("arg: {s}\n", .{arg});
    // }

}

fn parseSexpr(input: *[]const u8, pool: *MemoryPool(Sexpr)) !Sexpr {
    const result = try parseSexprTrue(input.*, pool);
    input.* = result.rest;
    return result.sexpr;
}

fn parseSexprTrue(input: []const u8, pool: *MemoryPool(Sexpr)) error{ OutOfMemory, BAD_INPUT }!struct { sexpr: Sexpr, rest: []const u8 } {
    var rest = input;
    skipWhitespace(&rest);
    if (rest[0] == '(') {
        const asdf = try parseSexprInsideParens(rest[1..], pool);
        return .{ .sexpr = asdf.sexpr, .rest = asdf.rest };
    }
    const asdf = try parseAtom(rest);
    return .{ .sexpr = Sexpr{ .atom = asdf.atom }, .rest = asdf.rest };
}

fn parseSexprInsideParens(input: []const u8, pool: *MemoryPool(Sexpr)) !struct { sexpr: Sexpr, rest: []const u8 } {
    var rest = input;
    skipWhitespace(&rest);
    if (rest[0] == ')') {
        return .{ .sexpr = Sexpr.nil, .rest = rest[1..] };
    }
    if (rest[0] == '.') {
        const final_asdf = try parseSexprTrue(rest[1..], pool);
        rest = final_asdf.rest;
        skipWhitespace(&rest);
        if (rest[0] != ')') return error.BAD_INPUT;
        return .{ .sexpr = final_asdf.sexpr, .rest = rest[1..] };
    }
    const first_asdf = try parseSexprTrue(rest, pool);
    const rest_asdf = try parseSexprInsideParens(first_asdf.rest, pool);

    const left: *Sexpr = try pool.create();
    left.* = first_asdf.sexpr;
    const right: *Sexpr = try pool.create();
    right.* = rest_asdf.sexpr;

    return .{ .sexpr = .{ .pair = .{ .left = left, .right = right } }, .rest = rest_asdf.rest };
}

fn parseAtom(input: []const u8) !struct { atom: Atom, rest: []const u8 } {
    const word_breaks = .{ '(', ')', ':', '.', ';' } ++ std.ascii.whitespace;
    const rest = std.mem.trimLeft(u8, input, &std.ascii.whitespace);
    const word_end = std.mem.indexOfAnyPos(u8, rest, 0, &word_breaks) orelse rest.len;
    return .{
        .atom = Atom{ .value = rest[0..word_end] },
        .rest = rest[word_end..],
    };
}

test "parse atom" {
    const raw_input = "hello there";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    var remaining: []const u8 = raw_input;
    const asdf1 = try parseSexprTrue(remaining, &pool);
    const atom1 = asdf1.sexpr.atom;
    remaining = asdf1.rest;
    const asdf2 = try parseSexprTrue(remaining, &pool);
    const atom2 = asdf2.sexpr.atom;
    remaining = asdf2.rest;

    try std.testing.expectEqualStrings("hello", atom1.value);
    try std.testing.expectEqualStrings("there", atom2.value);
    try std.testing.expectEqualStrings("", remaining);
}

test "helper function" {
    const raw_input = "hello there";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    var remaining: []const u8 = raw_input;
    const sexpr1 = try parseSexpr(&remaining, &pool);
    const sexpr2 = try parseSexpr(&remaining, &pool);

    try std.testing.expectEqualStrings("hello", sexpr1.atom.value);
    try std.testing.expectEqualStrings("there", sexpr2.atom.value);
    try std.testing.expectEqualStrings("", remaining);
}

test "parse pair" {
    const raw_input = "(hello . there)";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    var remaining: []const u8 = raw_input;
    const sexpr = try parseSexpr(&remaining, &pool);
    const atom1 = sexpr.pair.left.atom;
    const atom2 = sexpr.pair.right.atom;

    try std.testing.expectEqualStrings("hello", atom1.value);
    try std.testing.expectEqualStrings("there", atom2.value);
    try std.testing.expectEqualStrings("", remaining);
}

test "parse nested" {
    const raw_input = "(hello . (there . you))";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    var remaining: []const u8 = raw_input;
    const sexpr = try parseSexpr(&remaining, &pool);
    const atom1 = sexpr.pair.left.atom;
    const atom2 = sexpr.pair.right.pair.left.atom;
    const atom3 = sexpr.pair.right.pair.right.atom;

    try std.testing.expectEqualStrings("hello", atom1.value);
    try std.testing.expectEqualStrings("there", atom2.value);
    try std.testing.expectEqualStrings("you", atom3.value);
    try std.testing.expectEqualStrings("", remaining);
}

test "parse one element list" {
    const raw_input = "(hello)";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    var remaining: []const u8 = raw_input;
    const sexpr = try parseSexpr(&remaining, &pool);
    const atom1 = sexpr.pair.left.atom;
    const atom2 = sexpr.pair.right.atom;

    try std.testing.expectEqualStrings("hello", atom1.value);
    try std.testing.expectEqualStrings("nil", atom2.value);
    try std.testing.expectEqualStrings("", remaining);
}

test "parse complex stuff" {
    var raw_input_1: []const u8 = "(() a (b c) . (d e))";
    var raw_input_2: []const u8 = "(nil . (a . ((b . (c . nil)) . (d . (e . nil)))))";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    const actual = (try parseSexpr(&raw_input_1, &pool));
    const expected = (try parseSexpr(&raw_input_2, &pool));

    try std.testing.expect(expected.equals(actual));
}

test "to string" {
    var raw_input: []const u8 = "(() a (b c) d . e)";
    const expected = "(nil a (b c) d . e)";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    const sexpr = try parseSexpr(&raw_input, &pool);
    var buffer: [expected.len]u8 = undefined;
    const result = try writeSexprHelper(sexpr, &buffer, std.testing.allocator);

    try std.testing.expectEqualStrings(expected, result);
}

fn writeSexprHelper(sexpr: Sexpr, buffer: []u8, temp_allocator: std.mem.Allocator) ![]u8 {
    var in_stream = std.io.fixedBufferStream(buffer);
    const writer = in_stream.writer().any();
    try writeSexpr(sexpr, writer, temp_allocator);
    return in_stream.getWritten();
}

fn writeSexpr(s: Sexpr, w: std.io.AnyWriter, temp_allocator: std.mem.Allocator) !void {
    switch (s) {
        .atom => |atom| {
            try w.writeAll(atom.value);
        },
        .pair => {
            var asdf = std.ArrayList(*const Sexpr).init(temp_allocator);
            defer asdf.deinit();

            const sentinel = try asListPlusSentinel(s, &asdf);
            try w.writeAll("(");
            for (asdf.items, 0..) |item, k| {
                try writeSexpr(item.*, w, temp_allocator);
                if (k + 1 < asdf.items.len) {
                    try w.writeAll(" ");
                }
            }
            if (sentinel.equals(Sexpr.nil)) {
                try w.writeAll(")");
            } else {
                try w.writeAll(" . ");
                try writeSexpr(sentinel, w, temp_allocator);
                try w.writeAll(")");
            }
        },
    }
}

fn asListPlusSentinel(s: Sexpr, l: *std.ArrayList(*const Sexpr)) !Sexpr {
    switch (s) {
        .atom => return s,
        .pair => |p| {
            try l.append(p.left);
            return try asListPlusSentinel(p.right.*, l);
        },
    }
}

test "fill template" {
    const pattern_input = "((@a . b) . @c)";
    const value_input = "((first . b) . second)";

    const template_input = "(@a . (b . @c))";
    const expected = "(first b . second)";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    const pattern = (try parseSexprTrue(pattern_input, &pool)).sexpr;
    const value = (try parseSexprTrue(value_input, &pool)).sexpr;
    const template = (try parseSexprTrue(template_input, &pool)).sexpr;

    const result = (try bindAndFill(&pattern, &value, &template, &pool, std.testing.allocator)).?.*;

    var buffer: [expected.len]u8 = undefined;
    var in_stream = std.io.fixedBufferStream(&buffer);
    const writer = in_stream.writer().any();
    try writeSexpr(result, writer, std.testing.allocator);

    try std.testing.expectEqualStrings(expected, in_stream.getWritten());
}

fn bindAndFill(pattern: *const Sexpr, value: *const Sexpr, template: *const Sexpr, pool: *MemoryPool(Sexpr), temp_allocator: std.mem.Allocator) !?*const Sexpr {
    // var bindings = std.StringArrayHashMap(*const Sexpr).init(temp_allocator);
    var bindings = std.ArrayList(Binding).init(temp_allocator);
    defer bindings.deinit();
    const valid = try generateBindings(pattern, value, &bindings);
    if (!valid) return null;

    // try std.testing.expectEqual(2, bindings.count());

    return try fillTemplate(template, &bindings, pool);
}

// fn generateBindings(pattern: *const Sexpr, value: *const Sexpr, bindings: *std.StringArrayHashMap(*const Sexpr)) !bool {
fn generateBindings(pattern: *const Sexpr, value: *const Sexpr, bindings: *Bindings) !bool {
    switch (pattern.*) {
        .atom => |pat| {
            if (pat.isVar()) {
                // TODO: return false if variable was already bound
                // try bindings.put(pat.value, value);
                try bindings.append(.{ .name = pat.value, .value = value });
                return true;
            } else {
                switch (value.*) {
                    .pair => return false,
                    // TODO: use Atom.equals
                    .atom => |val| return std.mem.eql(u8, pat.value, val.value),
                }
            }
        },
        .pair => |pat| {
            switch (value.*) {
                .atom => return false,
                .pair => |val| {
                    return (try generateBindings(pat.left, val.left, bindings)) and (try generateBindings(pat.right, val.right, bindings));
                },
            }
        },
    }
}

// fn fillTemplate(template: *const Sexpr, bindings: *std.StringArrayHashMap(*const Sexpr), pool: *MemoryPool(Sexpr)) !*const Sexpr {
fn fillTemplate(template: *const Sexpr, bindings: *Bindings, pool: *MemoryPool(Sexpr)) !*const Sexpr {
    switch (template.*) {
        .atom => |templ| {
            if (templ.isVar()) {
                // return bindings.get(templ.value).?;
                for (0..bindings.items.len) |k| {
                    const bind = bindings.items[bindings.items.len - k - 1];
                    if (std.mem.eql(u8, bind.name, templ.value)) {
                        return bind.value;
                    }
                }
                return error.BAD_INPUT;
            } else {
                return template;
            }
        },
        .pair => |templ| {
            const left = try fillTemplate(templ.left, bindings, pool);
            const right = try fillTemplate(templ.right, bindings, pool);
            const result: *Sexpr = try pool.create();
            result.* = Sexpr{ .pair = Pair{ .left = left, .right = right } };
            return result;
        },
    }
}

test "parse flat fnk" {
    const raw_input =
        \\ add {
        \\  (nil . @b) -> @b;
        \\  ((S . @a) . @b) -> add: (@a . (S . @b));
        \\ }
    ;

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    var remaining: []const u8 = raw_input;
    const fnk = try parseFnk(&remaining, &pool, std.testing.allocator);
    defer fnk.body.arena.deinit();

    try std.testing.expectEqualStrings("add", fnk.name.atom.value);
    try std.testing.expectEqual(2, fnk.body.cases.items.len);
    try std.testing.expectEqualStrings("@a", fnk.body.cases.items[1].pattern.pair.left.pair.right.atom.value);
    try std.testing.expectEqual(null, fnk.body.cases.items[1].next);
    try std.testing.expectEqualStrings("", remaining);
}

test "parse nested fnk" {
    const raw_input =
        \\ senseless {
        \\  (nil . @b) -> @b {
        \\      nil -> nil;
        \\      @a -> (asdf @a);
        \\  }
        \\  ((S . @a) . @b) -> add: (@a . (S . @b)) {
        \\      @x -> @x {
        \\          @y -> @y;
        \\      }
        \\      @x -> @x {
        \\          @y -> @y;
        \\      }
        \\  }
        \\ }
    ;

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    var remaining: []const u8 = raw_input;
    const fnk = try parseFnk(&remaining, &pool, std.testing.allocator);
    defer fnk.body.arena.deinit();

    try std.testing.expectEqual(2, fnk.body.cases.items.len);
    try std.testing.expectEqual(2, fnk.body.cases.items[1].next.?.items.len);
    try std.testing.expectEqual(1, fnk.body.cases.items[1].next.?.items[1].next.?.items.len);
    // try std.testing.expectEqualStrings("@a", fnk.cases.items[1].pattern.pair.left.pair.right.atom.value);
    try std.testing.expectEqualStrings("", remaining);
}

fn parseFnk(input: *[]const u8, pool: *MemoryPool(Sexpr), allocator: std.mem.Allocator) !Fnk {
    const result = try parseFnkTrue(input.*, pool, allocator);
    input.* = result.rest;
    return result.fnk;
}

fn parseFnkTrue(input: []const u8, pool: *MemoryPool(Sexpr), allocator: std.mem.Allocator) !struct { fnk: Fnk, rest: []const u8 } {
    var rest = input;
    skipWhitespace(&rest);
    const name = try parseSexpr(&rest, pool);
    skipWhitespace(&rest);
    // try parseChar(&rest, ':');
    // skipWhitespace(&rest);
    try parseChar(&rest, '{');
    var arena = std.heap.ArenaAllocator.init(allocator);
    const cases = try parseMatchCases(&rest, pool, &arena);
    skipWhitespace(&rest);
    return .{ .fnk = Fnk{ .name = name, .body = FnkBody{ .cases = cases, .arena = arena } }, .rest = rest };
}

fn parseMatchCases(input: *[]const u8, pool: *MemoryPool(Sexpr), arena: *std.heap.ArenaAllocator) !InnerCases {
    var list = std.ArrayListUnmanaged(MatchCaseDefinition){};
    skipWhitespace(input);
    while (!parseCharIfPossible(input, '}')) {
        const pattern = try parseSexpr(input, pool);
        skipWhitespace(input);
        try parseChar(input, '-');
        try parseChar(input, '>');
        skipWhitespace(input);
        const fn_name_or_template = try parseSexpr(input, pool);
        skipWhitespace(input);
        var fn_name: Sexpr = undefined;
        var template: Sexpr = undefined;
        if (parseCharIfPossible(input, ':')) {
            fn_name = fn_name_or_template;
            template = try parseSexpr(input, pool);
            skipWhitespace(input);
        } else {
            fn_name = Sexpr.identity;
            template = fn_name_or_template;
        }
        var next: ?InnerCases = undefined;
        if (parseCharIfPossible(input, ';')) {
            next = null;
        } else {
            try parseChar(input, '{');
            next = try parseMatchCases(input, pool, arena);
        }
        skipWhitespace(input);

        try list.append(arena.allocator(), .{
            .pattern = pattern,
            .fn_name = fn_name,
            .template = template,
            .next = next,
        });
    }
    return list;
}

fn skipWhitespace(input: *[]const u8) void {
    input.* = std.mem.trimLeft(u8, input.*, &std.ascii.whitespace);
    while (std.mem.startsWith(u8, input.*, "//")) {
        input.* = input.*[(std.mem.indexOfScalar(u8, input.*, '\n').? + 1)..];
    }
}

fn parseChar(input: *[]const u8, comptime expected: u8) !void {
    if (input.*[0] != expected) return error.BAD_INPUT;
    input.* = input.*[1..];
}

fn parseCharIfPossible(input: *[]const u8, comptime expected: u8) bool {
    if (input.*[0] != expected) return false;
    input.* = input.*[1..];
    return true;
}

test "apply flat fnk" {
    var raw_fnk: []const u8 =
        \\ add {
        \\  (nil . @b) -> @b;
        \\  ((S . @a) . @b) -> add: (@a . (S . @b));
        \\ }
    ;
    var raw_input: []const u8 = "( (S S) . (S S) )";
    var raw_expected: []const u8 = "(S S S S)";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    const add_fnk = try parseFnk(&raw_fnk, &pool, std.testing.allocator);
    defer add_fnk.body.arena.deinit();

    const input = try parseSexpr(&raw_input, &pool);
    const expected = try parseSexpr(&raw_expected, &pool);

    var fnk_collection = FnkCollection.init(std.testing.allocator);
    defer fnk_collection.deinit();
    try fnk_collection.put(add_fnk.name, add_fnk.body);
    const actual = try applyFnk(&fnk_collection, add_fnk.name, &input, std.testing.allocator, &pool, std.testing.allocator);

    try std.testing.expect(Sexpr.equals(expected, actual));
}

test "apply nested fnk" {
    var raw_fnk: []const u8 =
        \\ binaryInc {
        \\      nil -> (b1);
        \\      (b0 . @rest) -> (b1 . @rest);
        \\      (b1 . @rest) -> binaryInc: @rest {
        \\          @new_rest -> (b0 . @new_rest);
        \\      }
        \\ }
    ;
    var raw_input: []const u8 = "(b1 b1)";
    var raw_expected: []const u8 = "(b0 b0 b1)";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    const add_fnk = try parseFnk(&raw_fnk, &pool, std.testing.allocator);
    defer add_fnk.body.arena.deinit();

    const input = try parseSexpr(&raw_input, &pool);
    const expected = try parseSexpr(&raw_expected, &pool);

    var fnk_collection = FnkCollection.init(std.testing.allocator);
    defer fnk_collection.deinit();
    try fnk_collection.put(add_fnk.name, add_fnk.body);
    const actual = try applyFnk(&fnk_collection, add_fnk.name, &input, std.testing.allocator, &pool, std.testing.allocator);

    // std.debug.print("\n\nactual: {any}\n\n", .{actual});

    // std.debug.lockStdErr();
    // defer std.debug.unlockStdErr();
    // const stderr = std.io.getStdErr().writer();
    // try writeSexpr(expected, stderr.any(), std.testing.allocator);

    try expectEqualSexprs(expected, actual);
    try std.testing.expect(Sexpr.equals(expected, actual));
}

fn applyFnk(
    all_fnks: *FnkCollection,
    name: Sexpr,
    input: *const Sexpr,
    temp_bindings_allocator: std.mem.Allocator,
    pool: *MemoryPool(Sexpr),
    allocator_for_new_fnks: std.mem.Allocator,
) !Sexpr {
    if (name.equals(Sexpr.identity)) return input.*;
    if (name.equals(Sexpr.@"eqAtoms?")) return switch (input.*) {
        .atom => Sexpr.fromBool(false),
        .pair => |p| Sexpr.fromBool(p.left.*.isAtom() and p.right.*.isAtom() and Sexpr.equals(p.left.*, p.right.*)),
    };
    const fnk = all_fnks.get(name).?;

    // var bindings = std.StringArrayHashMap(*const Sexpr).init(temp_bindings_allocator);
    var bindings = std.ArrayList(Binding).init(temp_bindings_allocator);
    defer bindings.deinit();

    const stderr = std.io.getStdErr().writer();
    stderr.print("\napplying fnk with name ", .{}) catch unreachable;
    writeSexpr(name, stderr.any(), allocator_for_new_fnks) catch unreachable;
    stderr.print(" on input ", .{}) catch unreachable;
    writeSexpr(input.*, stderr.any(), allocator_for_new_fnks) catch unreachable;
    stderr.print("\n", .{}) catch unreachable;

    // var buffer: [1000]u8 = undefined;
    // const result = writeSexprHelper(name, &buffer, std.heap.page_allocator) catch unreachable;
    // std.debug.print("call fnk: {s}\n", .{result});

    return try applyMatchOptions(all_fnks, fnk.cases, input, &bindings, pool, allocator_for_new_fnks);
}

fn findFunktion(
    all_fnks: *FnkCollection,
    name: Sexpr,
    temp_bindings_allocator: std.mem.Allocator,
    pool: *MemoryPool(Sexpr),
    allocator_for_new_fnks: std.mem.Allocator,
) !FnkBody {
    _ = temp_bindings_allocator; // autofix
    _ = pool; // autofix
    _ = allocator_for_new_fnks; // autofix
    if (all_fnks.get(name)) |fnk| {
        return fnk;
    } else switch (name) {
        .atom => return null,
        .pair => |p| {
            _ = p; // autofix
            return error.TODO;
            // // try to compile it!
            // const asdf = try applyFnk(all_fnks, p.left.*, p.right, temp_bindings_allocator, pool, allocator_for_new_fnks);
            // const cases = try fnkFromSexpr(asdf);
            // all_fnks.put(name, cases);
        },
    }
}

// fn fnkFromSexpr(s: Sexpr, allocator_for_new_fnks: std.mem.Allocator, pool: *MemoryPool(Sexpr)) !FnkBody {
//     var arena = std.heap.ArenaAllocator.init(allocator_for_new_fnks);
//     var cases = std.ArrayListUnmanaged(MatchCaseDefinition){};
//     var cur: Sexpr = s.pair.left;
//     while (!cur.equals(Sexpr.nil)) {
//         const pattern = try internalFromExternal(cur.pair.left, pool);
//         const fn_name = cur.pair.right.pair.left;
//         const template = cur.pair.right.pair.right.pair.left;
//         const next = cur.pair.right.pair.right.pair.right;
//         _ = pattern; // autofix
//         _ = fn_name; // autofix
//         _ = template; // autofix
//         _ = next; // autofix
//     }
//     _ = cases; // autofix
//     _ = arena; // autofix
//     // const cases = try parseMatchCases(&rest, pool, &arena);
//     // var asdf = std.ArrayList(*const Sexpr).init(temp_allocator);
//     // defer asdf.deinit();

//     // const sentinel = try asListPlusSentinel(s, &asdf);
// }

// // ((atom . aaa) . (var . bbb)) => (aaa . @bbb)
// fn internalFromExternal(s: *const Sexpr, pool: *MemoryPool(Sexpr)) !Sexpr {
//     _ = pool; // autofix
//     switch (s.*) {
//         .atom => return error.BAD_INPUT,
//         .pair => |p| {
//             if (p.left.equals(Sexpr.atom)) return p.right.*;
//             if (p.left.equals(Sexpr.@"var")) {
//                 const res: *Sexpr = try pool.create();
//                 res.*
//             }
//         },
//     }
// }

fn applyMatchOptions(
    all_fnks: *FnkCollection,
    cases: InnerCases,
    input: *const Sexpr,
    bindings: *Bindings,
    pool: *MemoryPool(Sexpr),
    allocator_for_new_fnks: std.mem.Allocator,
) error{ OutOfMemory, NO_VALID_MATCH, BAD_INPUT }!Sexpr {
    const initial_bindings_count = bindings.items.len;
    // defer undoLastBindings(bindings, initial_bindings_count) catch @panic("oops");
    defer undoLastBindings(bindings, initial_bindings_count);
    for (cases.items) |case| {
        if (!try generateBindings(&case.pattern, input, bindings)) {
            undoLastBindings(bindings, initial_bindings_count);
            continue;
        }
        const argument = try fillTemplate(&case.template, bindings, pool);

        const stderr = std.io.getStdErr().writer();
        stderr.print("matched pattern ", .{}) catch unreachable;
        writeSexpr(case.pattern, stderr.any(), allocator_for_new_fnks) catch unreachable;
        stderr.print(" with the input ", .{}) catch unreachable;
        writeSexpr(input.*, stderr.any(), allocator_for_new_fnks) catch unreachable;
        stderr.print(" and template ", .{}) catch unreachable;
        writeSexpr(case.template, stderr.any(), allocator_for_new_fnks) catch unreachable;
        stderr.print(", generating argument ", .{}) catch unreachable;
        writeSexpr(argument.*, stderr.any(), allocator_for_new_fnks) catch unreachable;
        stderr.print("\n\n", .{}) catch unreachable;

        const value = try applyFnk(
            all_fnks,
            case.fn_name,
            argument,
            bindings.allocator,
            pool,
            allocator_for_new_fnks,
        );

        stderr.print("got the value: ", .{}) catch unreachable;
        writeSexpr(value, stderr.any(), allocator_for_new_fnks) catch unreachable;
        stderr.print("\n", .{}) catch unreachable;

        stderr.print("reminder: matched pattern ", .{}) catch unreachable;
        writeSexpr(case.pattern, stderr.any(), allocator_for_new_fnks) catch unreachable;
        stderr.print(" with the input ", .{}) catch unreachable;
        writeSexpr(input.*, stderr.any(), allocator_for_new_fnks) catch unreachable;
        stderr.print(" and template ", .{}) catch unreachable;
        writeSexpr(case.template, stderr.any(), allocator_for_new_fnks) catch unreachable;
        stderr.print(", generating argument ", .{}) catch unreachable;
        writeSexpr(argument.*, stderr.any(), allocator_for_new_fnks) catch unreachable;
        stderr.print("\n\n", .{}) catch unreachable;

        if (case.next) |next| {
            return try applyMatchOptions(all_fnks, next, &value, bindings, pool, allocator_for_new_fnks);
        } else {
            return value;
        }
    }

    // var buffer: [1000]u8 = undefined;
    // const result = writeSexprHelper(input.*, &buffer, std.heap.page_allocator) catch unreachable;
    // std.debug.print("no valid match for input: {s}\n", .{result});
    // std.debug.print("cases len: {d}\n", .{cases.items.len});
    // const result2= writeSexprHelper(.*, &buffer, std.heap.page_allocator) catch unreachable;
    // std.debug.print("cases[0] pattern:", .{result});
    return error.NO_VALID_MATCH;
}

fn undoLastBindings(bindings: *Bindings, original_count: usize) void {
    bindings.shrinkAndFree(original_count);
    // const did_something = bindings.unmanaged.entries.len != original_count;
    // _ = did_something; // autofix
    // bindings.unmanaged.entries.shrinkRetainingCapacity(original_count);
    // try bindings.reIndex();
    // if (did_something) {
    //     try bindings.reIndex();
    // }
}

pub fn expectEqualSexprs(expected: Sexpr, actual: Sexpr) !void {
    switch (expected) {
        .atom => |expected_atom| switch (actual) {
            .atom => |actual_atom| {
                return std.testing.expectEqualStrings(expected_atom.value, actual_atom.value);
            },
            .pair => |actual_pair| {
                std.debug.print("expected atom '{s}' but found a pair {any}\n", .{ expected_atom.value, actual_pair });
                return error.TestExpectedEqual;
            },
        },
        .pair => |expected_pair| switch (actual) {
            .atom => |actual_atom| {
                std.debug.print("expected pair but found an atom '{s}'\n", .{actual_atom.value});
                return error.TestExpectedEqual;
            },
            .pair => |actual_pair| {
                try expectEqualSexprs(expected_pair.left.*, actual_pair.left.*);
                try expectEqualSexprs(expected_pair.right.*, actual_pair.right.*);
            },
        },
    }
}
