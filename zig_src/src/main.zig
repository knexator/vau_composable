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

    const nil: Atom = .{
        .value = "nil",
    };

    pub fn equals(this: Atom, other: Atom) bool {
        return std.mem.eql(u8, this.value, other.value);
    }
};
const Pair = struct {
    left: *const Sexpr,
    right: *const Sexpr,
};
const Sexpr = union(enum) {
    atom: Atom,
    pair: Pair,

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

fn parseSexpr(input: []const u8, pool: *MemoryPool(Sexpr)) error{ OutOfMemory, BAD_INPUT }!struct { sexpr: Sexpr, rest: []const u8 } {
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
        const final_asdf = try parseSexpr(rest[1..], pool);
        rest = std.mem.trimLeft(u8, final_asdf.rest, &std.ascii.whitespace);
        if (rest[0] != ')') return error.BAD_INPUT;
        return .{ .sexpr = final_asdf.sexpr, .rest = rest[1..] };
    }
    const first_asdf = try parseSexpr(rest, pool);
    const rest_asdf = try parseSexprInsideParens(first_asdf.rest, pool);

    const left: *Sexpr = try pool.create();
    left.* = first_asdf.sexpr;
    const right: *Sexpr = try pool.create();
    right.* = rest_asdf.sexpr;

    return .{ .sexpr = .{ .pair = .{ .left = left, .right = right } }, .rest = rest_asdf.rest };
}

fn parseAtom(input: []const u8) !struct { atom: Atom, rest: []const u8 } {
    const word_breaks: [std.ascii.whitespace.len + 1]u8 = .{')'} ++ std.ascii.whitespace;
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
    const asdf1 = try parseSexpr(remaining, &pool);
    const atom1 = asdf1.sexpr.atom;
    remaining = asdf1.rest;
    const asdf2 = try parseSexpr(remaining, &pool);
    const atom2 = asdf2.sexpr.atom;
    remaining = asdf2.rest;

    try std.testing.expectEqualStrings("hello", atom1.value);
    try std.testing.expectEqualStrings("there", atom2.value);
    try std.testing.expectEqualStrings("", remaining);
}

test "parse pair" {
    const raw_input = "(hello . there)";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    var remaining: []const u8 = raw_input;
    const asdf = try parseSexpr(remaining, &pool);
    const atom1 = asdf.sexpr.pair.left.atom;
    const atom2 = asdf.sexpr.pair.right.atom;
    remaining = asdf.rest;

    try std.testing.expectEqualStrings("hello", atom1.value);
    try std.testing.expectEqualStrings("there", atom2.value);
    try std.testing.expectEqualStrings("", remaining);
}

test "parse nested" {
    const raw_input = "(hello . (there . you))";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    var remaining: []const u8 = raw_input;
    const asdf = try parseSexpr(remaining, &pool);
    const atom1 = asdf.sexpr.pair.left.atom;
    const atom2 = asdf.sexpr.pair.right.pair.left.atom;
    const atom3 = asdf.sexpr.pair.right.pair.right.atom;
    remaining = asdf.rest;

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
    const asdf = try parseSexpr(remaining, &pool);
    const atom1 = asdf.sexpr.pair.left.atom;
    const atom2 = asdf.sexpr.pair.right.atom;
    remaining = asdf.rest;

    try std.testing.expectEqualStrings("hello", atom1.value);
    try std.testing.expectEqualStrings("nil", atom2.value);
    try std.testing.expectEqualStrings("", remaining);
}

test "parse complex stuff" {
    const raw_input_1 = "(() a (b c) . (d e))";
    const raw_input_2 = "(nil . (a . ((b . (c . nil)) . (d . (e . nil)))))";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    const actual = (try parseSexpr(raw_input_1, &pool)).sexpr;
    const expected = (try parseSexpr(raw_input_2, &pool)).sexpr;

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
    const sexpr = (try parseSexpr(raw_input, &pool)).sexpr;
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
