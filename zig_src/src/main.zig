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
};
const Pair = struct {
    left: *const Sexpr,
    right: *const Sexpr,
};
const Sexpr = union(enum) {
    atom: Atom,
    pair: Pair,
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
// , allocator: std.mem.Allocator
fn parseSexpr(input: []const u8, pool: *MemoryPool(Sexpr)) !struct { sexpr: Sexpr, rest: []const u8 } {
    var rest = std.mem.trimLeft(u8, input, &std.ascii.whitespace);
    if (rest[0] == '(') {
        const first_asdf = try parseSexpr(rest[1..], pool);
        const left: *Sexpr = try pool.create();
        left.* = first_asdf.sexpr;
        rest = std.mem.trimLeft(u8, first_asdf.rest, &std.ascii.whitespace);
        if (rest[0] == '.') {
            const second_asdf = try parseSexpr(rest[1..], pool);
            const right: *Sexpr = try pool.create();
            right.* = second_asdf.sexpr;
            rest = std.mem.trimLeft(u8, second_asdf.rest, &std.ascii.whitespace);
            if (rest[0] != ')') return error.BAD_INPUT;
            return .{
                .sexpr = .{ .pair = .{ .left = left, .right = right } },
                .rest = rest[1..],
            };
        } else if (rest[0] == ')') {
            const right: *Sexpr = try pool.create();
            right.* = .{ .atom = Atom.nil };
            return .{
                .sexpr = .{ .pair = .{ .left = left, .right = right } },
                .rest = rest[1..],
            };
        } else return error.TODO;
    }
    const asdf = try parseAtom(rest);
    return .{ .sexpr = Sexpr{ .atom = asdf.atom }, .rest = asdf.rest };
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
    const raw_input = "( hello )";

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

// test "parse pair" {
//     const input = "(hello . there)";
//     var fbs = std.io.fixedBufferStream(input);
//     const reader = fbs.reader();

//     const pair = try parseSexpr(std.testing.allocator, reader);
//     defer std.testing.allocator.free(pair.left.atom.value);
//     defer std.testing.allocator.free(pair.right.atom.value);

//     try std.testing.expectEqualStrings("hello", pair.left.atom.value);
//     try std.testing.expectEqualStrings("there", pair.right.atom.value);
// }

// pub fn PeekableReader(comptime peekable_size: usize, comptime ReaderType: type) type {
//     return struct {
//         unbuffered_reader: ReaderType,
//         buf: [peekable_size]u8 = undefined,
//         start: usize = 0,
//         end: usize = 0,

//         const Self = @This();

//         pub fn peek(self: *Self, dest: []u8)
//     };
// }

// test "simple test" {
//     var list = std.ArrayList(i32).init(std.testing.allocator);
//     defer list.deinit(); // try commenting this out and see if zig detects the memory leak!
//     try list.append(42);
//     try std.testing.expectEqual(@as(i32, 42), list.pop());
// }
