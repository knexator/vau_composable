const std = @import("std");

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
fn parseSexpr(input: []const u8) !struct { sexpr: Sexpr, rest: []const u8 } {
    // if (input[0] == '(') {
    //      = parseSexpr(input: []const u8)
    // }
    var rest = std.mem.trimLeft(u8, input, &std.ascii.whitespace);
    if (rest[0] == '(') {
        const first_asdf = try parseSexpr(rest[1..]);
        const left = first_asdf.sexpr;
        rest = std.mem.trimLeft(u8, first_asdf.rest, &std.ascii.whitespace);
        if (rest[0] == '.') {
            const second_asdf = try parseSexpr(rest[1..]);
            const right = second_asdf.sexpr;
            rest = std.mem.trimLeft(u8, second_asdf.rest, &std.ascii.whitespace);
            if (rest[0] != ')') return error.BAD_INPUT;
            return .{
                .sexpr = .{ .pair = .{ .left = &left, .right = &right } },
                .rest = rest[1..],
            };
        } else return error.TODO;
    }
    const asdf = try parseAtom(rest);
    return .{ .sexpr = Sexpr{ .atom = asdf.atom }, .rest = asdf.rest };
}

fn parseAtom(input: []const u8) !struct { atom: Atom, rest: []const u8 } {
    const rest = std.mem.trimLeft(u8, input, &std.ascii.whitespace);
    const word_end = std.mem.indexOfAnyPos(u8, rest, 0, &std.ascii.whitespace) orelse rest.len;
    return .{
        .atom = Atom{ .value = rest[0..word_end] },
        .rest = rest[word_end..],
    };
}

fn parsePair(allocator: std.mem.Allocator, reader: anytype) !Pair {
    _ = allocator; // autofix
    _ = reader; // autofix
}

test "parse atom" {
    const raw_input = "hello there";

    var remaining: []const u8 = raw_input;
    const asdf1 = try parseSexpr(remaining);
    const atom1 = asdf1.sexpr.atom;
    remaining = asdf1.rest;
    const asdf2 = try parseSexpr(remaining);
    const atom2 = asdf2.sexpr.atom;
    remaining = asdf2.rest;

    try std.testing.expectEqualStrings("hello", atom1.value);
    try std.testing.expectEqualStrings("there", atom2.value);
    try std.testing.expectEqualStrings("", remaining);
}

test "parse pair" {
    const raw_input = "( hello . there )";

    var remaining: []const u8 = raw_input;
    const asdf = try parseSexpr(remaining);
    const atom1 = asdf.sexpr.pair.left.atom;
    const atom2 = asdf.sexpr.pair.right.atom;
    remaining = asdf.rest;

    try std.testing.expectEqualStrings("hello", atom1.value);
    try std.testing.expectEqualStrings("there", atom2.value);
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
