const std = @import("std");

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
    left: *Sexpr,
    right: *Sexpr,
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

fn parseSexpr(allocator: std.mem.Allocator, reader: anytype) !Sexpr {
    const atom = try parseAtom(allocator, reader);
    return Sexpr{ .atom = atom };
}

fn parseAtom(allocator: std.mem.Allocator, reader: anytype) !Atom {
    var buffer = std.ArrayList(u8).init(allocator);
    defer buffer.deinit();

    while (true) {
        const byte = reader.readByte() catch |err| switch (err) {
            error.EndOfStream => break,
            else => return err,
        };
        if (std.ascii.isWhitespace(byte)) {
            break;
        }
        try buffer.append(byte);
    }

    return Atom{ .value = try buffer.toOwnedSlice() };
}

fn parsePair(allocator: std.mem.Allocator, reader: anytype) !Pair {
    _ = allocator; // autofix
    _ = reader; // autofix
}

test "parse atom" {
    const input = "hello there";
    var fbs = std.io.fixedBufferStream(input);
    const reader = fbs.reader();

    const atom1 = (try parseSexpr(std.testing.allocator, reader)).atom;
    defer std.testing.allocator.free(atom1.value);
    const atom2 = (try parseSexpr(std.testing.allocator, reader)).atom;
    defer std.testing.allocator.free(atom2.value);

    try std.testing.expectEqualStrings("hello", atom1.value);
    try std.testing.expectEqualStrings("there", atom2.value);
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

// pub fn PeekableReader() type {}

// test "simple test" {
//     var list = std.ArrayList(i32).init(std.testing.allocator);
//     defer list.deinit(); // try commenting this out and see if zig detects the memory leak!
//     try list.append(42);
//     try std.testing.expectEqual(@as(i32, 42), list.pop());
// }
