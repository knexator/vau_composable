const std = @import("std");
const MemoryPool = std.heap.MemoryPool;

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

    const nil: Atom = .{ .value = "nil" };

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

    const identity = Sexpr{ .atom = .{ .value = "identity" } };

    pub fn equals(this: Sexpr, other: Sexpr) bool {
        return switch (this) {
            .atom => switch (other) {
                .atom => this.atom.equals(other.atom),
                .pair => false,
            },
            .pair => switch (other) {
                .atom => false,
                .pair => this.pair.left.equals(other.pair.left.*) and this.pair.right.equals(other.pair.right.*),
            },
        };
    }
};

const InnerCases = std.ArrayListUnmanaged(MatchCaseDefinition);
const MatchCaseDefinition = struct {
    pattern: Sexpr,
    fn_name: Sexpr,
    template: Sexpr,
    next: ?InnerCases,
};

const Fnk = struct {
    name: Sexpr,
    cases: InnerCases,
    arena: std.heap.ArenaAllocator,
};

pub fn main() !void {
    const stdout_file = std.io.getStdOut().writer();
    var bw = std.io.bufferedWriter(stdout_file);
    const stdout = bw.writer();

    try stdout.print("@sizeOf(Pair): {d}\n", .{@sizeOf(Pair)});
    try stdout.print("@sizeOf(Atom): {d}\n", .{@sizeOf(Atom)});
    try stdout.print("@sizeOf(Sexpr): {d}\n", .{@sizeOf(Sexpr)});

    // const allocator = std.heap.wasm_allocator;
    // var args = try std.process.argsWithAllocator(allocator);
    // defer args.deinit();
    // _ = args.skip();
    // while (args.next()) |arg| {
    //     var reader = std.io.fixedBufferStream.Reader.init(arg);
    //     parseSexpr(allocator, reader);
    //     try stdout.print("arg: {s}\n", .{arg});
    // }

    try bw.flush();
}

fn parseSexpr(input: *[]const u8, pool: *MemoryPool(Sexpr)) !Sexpr {
    const result = try parseSexprTrue(input.*, pool);
    input.* = result.rest;
    return result.sexpr;
}

fn parseSexprTrue(input: []const u8, pool: *MemoryPool(Sexpr)) error{ OutOfMemory, BAD_INPUT }!struct { sexpr: Sexpr, rest: []const u8 } {
    var rest = std.mem.trimLeft(u8, input, &std.ascii.whitespace);
    if (rest[0] == '(') {
        const asdf = try parseSexprInsideParens(rest[1..], pool);
        return .{ .sexpr = asdf.sexpr, .rest = asdf.rest };
    }
    const asdf = try parseAtom(rest);
    return .{ .sexpr = Sexpr{ .atom = asdf.atom }, .rest = asdf.rest };
}

fn parseSexprInsideParens(input: []const u8, pool: *MemoryPool(Sexpr)) !struct { sexpr: Sexpr, rest: []const u8 } {
    var rest = std.mem.trimLeft(u8, input, &std.ascii.whitespace);
    if (rest[0] == ')') {
        return .{ .sexpr = Sexpr{ .atom = Atom.nil }, .rest = rest[1..] };
    }
    if (rest[0] == '.') {
        const final_asdf = try parseSexprTrue(rest[1..], pool);
        rest = std.mem.trimLeft(u8, final_asdf.rest, &std.ascii.whitespace);
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
    const raw_input_1 = "(() a (b c) . (d e))";
    const raw_input_2 = "(nil . (a . ((b . (c . nil)) . (d . (e . nil)))))";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    const actual = (try parseSexprTrue(raw_input_1, &pool)).sexpr;
    const expected = (try parseSexprTrue(raw_input_2, &pool)).sexpr;

    try std.testing.expect(expected.equals(actual));
}

test "to string" {
    const raw_input = "(() a (b c) d . e)";
    const expected = "(nil a (b c) d . e)";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    var buffer: [expected.len]u8 = undefined;
    var in_stream = std.io.fixedBufferStream(&buffer);
    const writer = in_stream.writer().any();
    const sexpr = (try parseSexprTrue(raw_input, &pool)).sexpr;
    try writeSexpr(sexpr, writer, std.testing.allocator);

    try std.testing.expectEqualStrings(expected, in_stream.getWritten());
}

fn writeSexpr(s: Sexpr, w: std.io.AnyWriter, temp_allocator: std.mem.Allocator) !void {
    switch (s) {
        .atom => {
            try w.writeAll(s.atom.value);
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
            if (sentinel.equals(Sexpr{ .atom = Atom.nil })) {
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
        .pair => {
            try l.append(s.pair.left);
            return try asListPlusSentinel(s.pair.right.*, l);
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
    var bindings = std.StringArrayHashMap(*const Sexpr).init(temp_allocator);
    defer bindings.deinit();
    const valid = try generateBindings(pattern, value, &bindings);
    if (!valid) return null;

    // try std.testing.expectEqual(2, bindings.count());

    return try fillTemplate(template, &bindings, pool);
}

fn generateBindings(pattern: *const Sexpr, value: *const Sexpr, bindings: *std.StringArrayHashMap(*const Sexpr)) !bool {
    switch (pattern.*) {
        .atom => |pat| {
            if (pat.isVar()) {
                // TODO: return false if variable was already bound
                try bindings.put(pat.value, value);
                return true;
            } else {
                switch (value.*) {
                    .pair => return false,
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

fn fillTemplate(template: *const Sexpr, bindings: *std.StringArrayHashMap(*const Sexpr), pool: *MemoryPool(Sexpr)) !*const Sexpr {
    switch (template.*) {
        .atom => |templ| {
            if (templ.isVar()) {
                return bindings.get(templ.value).?;
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
        \\ add: {
        \\  (nil . @b) -> @b;
        \\  ((S . @a) . @b) -> add: (@a . (S . @b));
        \\ }
    ;

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    var remaining: []const u8 = raw_input;
    const fnk = try parseFnk(&remaining, &pool, std.testing.allocator);
    defer fnk.arena.deinit();

    try std.testing.expectEqualStrings("add", fnk.name.atom.value);
    try std.testing.expectEqual(2, fnk.cases.items.len);
    try std.testing.expectEqualStrings("@a", fnk.cases.items[1].pattern.pair.left.pair.right.atom.value);
    try std.testing.expectEqualStrings("", remaining);
}

fn parseFnk(input: *[]const u8, pool: *MemoryPool(Sexpr), allocator: std.mem.Allocator) !Fnk {
    const result = try parseFnkTrue(input.*, pool, allocator);
    input.* = result.rest;
    return result.fnk;
}

fn parseFnkTrue(input: []const u8, pool: *MemoryPool(Sexpr), allocator: std.mem.Allocator) !struct { fnk: Fnk, rest: []const u8 } {
    var rest = std.mem.trimLeft(u8, input, &std.ascii.whitespace);
    const name = try parseSexpr(&rest, pool);
    skipWhitespace(&rest);
    try parseChar(&rest, ':');
    skipWhitespace(&rest);
    try parseChar(&rest, '{');
    var arena = std.heap.ArenaAllocator.init(allocator);
    const cases = try parseMatchCases(&rest, pool, &arena);
    skipWhitespace(&rest);
    return .{ .fnk = Fnk{ .name = name, .cases = cases, .arena = arena }, .rest = rest };
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
            return error.TODO;
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
