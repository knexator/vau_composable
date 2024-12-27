const std = @import("std");
const MemoryPool = std.heap.MemoryPool;

// broken: zig build run -- save_debug.txt 'stuff' raw_file cosa.txt

// zig build -Doptimize=ReleaseFast run -- ../save_no_meta.txt '(advent day1 . p1)' '(4 1 2 2 6 SPACE SPACE SPACE 6 9 1 9 0 NEWLINE 8 9 3 1 8 SPACE SPACE SPACE 1 0 1 0 0 NEWLINE 5 9 4 1 9 SPACE SPACE SPACE 2 3 8 8 0 NEWLINE)'
// zig build -Doptimize=ReleaseFast run -- ../save.txt '(advent day1 p1 . raw)' raw_file ..\aoc_input_1_raw.txt

// Design decision 1: strings live on the input buffer

// TODO: don't run out of stack on bad inputs

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

    pub fn equals(this: Atom, other: Atom) bool {
        return std.mem.eql(u8, this.value, other.value);
    }
};
const Pair = struct {
    left: *const Sexpr,
    right: *const Sexpr,
};
const Sexpr = union(enum) {
    atom_var: Atom,
    atom_lit: Atom,
    pair: Pair,

    const @"return" = Sexpr.lit("return");
    const @"var" = Sexpr.lit("var");
    const atom = Sexpr.lit("atom");
    const nil = Sexpr.lit("nil");
    const identity = Sexpr.lit("identity");
    const @"eqAtoms?" = Sexpr.lit("eqAtoms?");
    const @"true" = Sexpr.lit("true");
    const @"false" = Sexpr.lit("false");

    pub fn lit(v: []const u8) Sexpr {
        return .{ .atom_lit = .{ .value = v } };
    }

    pub fn equals(this: Sexpr, other: Sexpr) bool {
        return switch (this) {
            .atom_lit => |this_atom| switch (other) {
                .atom_lit => |other_atom| this_atom.equals(other_atom),
                else => false,
            },
            .atom_var => |this_atom| switch (other) {
                .atom_var => |other_atom| this_atom.equals(other_atom),
                else => false,
            },
            .pair => |this_pair| switch (other) {
                .pair => |other_pair| this_pair.left.equals(other_pair.left.*) and this_pair.right.equals(other_pair.right.*),
                else => false,
            },
        };
    }

    pub fn isLit(this: Sexpr) bool {
        return switch (this) {
            .atom_lit => true,
            else => false,
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
            .atom_lit => |a| std.array_hash_map.hashString(a.value),
            .atom_var => |a| std.hash.uint32(std.array_hash_map.hashString(a.value)),
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

    // try stdout.print("@sizeOf(Pair): {d}\n", .{@sizeOf(Pair)});
    // try stdout.print("@sizeOf(Atom): {d}\n", .{@sizeOf(Atom)});
    // try stdout.print("@sizeOf(Sexpr): {d}\n", .{@sizeOf(Sexpr)});

    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer {
        const deinit_status = gpa.deinit();
        _ = deinit_status; // autofix
        // if (deinit_status == .leak) std.debug.panic("leaked memory!", .{});

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
    var input_raw: []const u8 = args.next().?;
    var original_input_raw: ?[]const u8 = null;
    defer if (original_input_raw) |asdf| {
        allocator.free(asdf);
    };
    if (std.mem.eql(u8, input_raw, "file")) {
        const input_file_name = args.next().?;

        const input_file = try std.fs.cwd().openFile(input_file_name, .{});
        defer input_file.close();

        original_input_raw = try input_file.readToEndAlloc(allocator, std.math.maxInt(usize));
        input_raw = original_input_raw.?;
    } else if (std.mem.eql(u8, input_raw, "raw_file")) {
        const input_file_name = args.next().?;

        const input_file = try std.fs.cwd().openFile(input_file_name, .{});
        defer input_file.close();
        var br = std.io.bufferedReader(input_file.reader());

        var contents = std.ArrayList(u8).init(allocator);
        defer contents.deinit();
        try contents.append('(');
        while (true) {
            const cur_byte = br.reader().readByte() catch break;
            if (cur_byte == 0x0D) continue; // ignore the CR char, assuming that it will be followed by a NL
            try contents.append('x');
            try contents.append(std.fmt.digitToChar(cur_byte >> 4, .upper));
            try contents.append(std.fmt.digitToChar(cur_byte & 0x0F, .upper));
            try contents.append(' ');
        }
        try contents.append(')');
        original_input_raw = try contents.toOwnedSlice();
        input_raw = original_input_raw.?;
    }

    const fn_name = try parseSexpr(&fn_name_raw, &pool);
    const input = try parseSexpr(&input_raw, &pool);

    // try stdout.print("fn name: ", .{});
    // try writeSexpr(fn_name, stdout.any(), temp_allocator);
    // try stdout.print("\n", .{});

    // try stdout.print("input: ", .{});
    // try writeSexpr(input, stdout.any(), temp_allocator);
    // try stdout.print("\n", .{});

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

    // plain way
    const result_1 = try applyFnk(&fnk_collection, fn_name, &input, temp_allocator, &pool, allocator);
    _ = result_1; // autofix

    // bounded stack
    var state_pool = MemoryPool(ExecutionState).init(allocator);
    defer state_pool.deinit();
    var state = try ExecutionState.start(
        &fnk_collection,
        fn_name,
        input,
        .{
            .pool = &pool,
            .allocator_for_new_fnks = allocator,
            .temp_bindings_allocator = temp_allocator,
            .state_pool = &state_pool,
        },
    );
    while (!state.isDone()) {
        state = try state.nextStep(&fnk_collection, .{
            .pool = &pool,
            .allocator_for_new_fnks = allocator,
            .temp_bindings_allocator = temp_allocator,
            .state_pool = &state_pool,
        });
    }
    const result_2 = state.cur_value;

    const result = result_2;

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
    if (asdf.is_var) {
        return .{ .sexpr = Sexpr{ .atom_var = asdf.atom }, .rest = asdf.rest };
    } else {
        return .{ .sexpr = Sexpr{ .atom_lit = asdf.atom }, .rest = asdf.rest };
    }
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

fn parseAtom(input: []const u8) !struct { atom: Atom, is_var: bool, rest: []const u8 } {
    const word_breaks = .{ '(', ')', ':', '.', ';' } ++ std.ascii.whitespace;
    const rest = std.mem.trimLeft(u8, input, &std.ascii.whitespace);
    const word_end = std.mem.indexOfAnyPos(u8, rest, 0, &word_breaks) orelse rest.len;
    const is_variable = rest[0] == '@';
    return .{
        .atom = Atom{ .value = rest[(if (is_variable) 1 else 0)..word_end] },
        .is_var = is_variable,
        .rest = rest[word_end..],
    };
}

test "parse atom" {
    const raw_input = "hello @there";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    var remaining: []const u8 = raw_input;
    const asdf1 = try parseSexprTrue(remaining, &pool);
    const atom1 = asdf1.sexpr;
    remaining = asdf1.rest;
    const asdf2 = try parseSexprTrue(remaining, &pool);
    const atom2 = asdf2.sexpr;
    remaining = asdf2.rest;

    try expectEqualSexprs(.{ .atom_lit = .{ .value = "hello" } }, atom1);
    try expectEqualSexprs(.{ .atom_var = .{ .value = "there" } }, atom2);
    try std.testing.expectEqualStrings("", remaining);
}

test "helper function" {
    const raw_input = "hello there";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    var remaining: []const u8 = raw_input;
    const sexpr1 = try parseSexpr(&remaining, &pool);
    const sexpr2 = try parseSexpr(&remaining, &pool);

    try expectEqualSexprs(.{ .atom_lit = .{ .value = "hello" } }, sexpr1);
    try expectEqualSexprs(.{ .atom_lit = .{ .value = "there" } }, sexpr2);
    try std.testing.expectEqualStrings("", remaining);
}

test "parse pair" {
    const raw_input = "(hello . there)";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    var remaining: []const u8 = raw_input;
    const sexpr = try parseSexpr(&remaining, &pool);

    try expectEqualSexprs(.{ .atom_lit = .{ .value = "hello" } }, sexpr.pair.left.*);
    try expectEqualSexprs(.{ .atom_lit = .{ .value = "there" } }, sexpr.pair.right.*);
    try std.testing.expectEqualStrings("", remaining);
}

test "parse nested" {
    const raw_input = "(hello . (there . you))";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    var remaining: []const u8 = raw_input;
    const sexpr = try parseSexpr(&remaining, &pool);
    const atom1 = sexpr.pair.left.atom_lit;
    const atom2 = sexpr.pair.right.pair.left.atom_lit;
    const atom3 = sexpr.pair.right.pair.right.atom_lit;

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
    const atom1 = sexpr.pair.left.atom_lit;
    const atom2 = sexpr.pair.right.atom_lit;

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
        .atom_lit => |atom| {
            try w.writeAll(atom.value);
        },
        .atom_var => |atom| {
            try w.writeAll("@");
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
        .atom_lit, .atom_var => return s,
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
        .atom_var => |pat| {
            // TODO: return false if variable was already bound
            // try bindings.put(pat.value, value);
            try bindings.append(.{ .name = pat.value, .value = value });
            return true;
        },
        .atom_lit => |pat| {
            switch (value.*) {
                .pair => return false,
                .atom_lit => |val| return val.equals(pat),
                .atom_var => return error.BAD_INPUT,
            }
        },
        .pair => |pat| {
            switch (value.*) {
                .atom_lit => return false,
                .atom_var => return error.BAD_INPUT,
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
        .atom_var => |templ| {
            // return bindings.get(templ.value).?;
            for (0..bindings.items.len) |k| {
                const bind = bindings.items[bindings.items.len - k - 1];
                if (std.mem.eql(u8, bind.name, templ.value)) {
                    return bind.value;
                }
            }
            return error.BAD_INPUT;
        },
        .atom_lit => return template,
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

    try std.testing.expectEqualStrings("add", fnk.name.atom_lit.value);
    try std.testing.expectEqual(2, fnk.body.cases.items.len);
    try std.testing.expectEqualStrings("a", fnk.body.cases.items[1].pattern.pair.left.pair.right.atom_var.value);
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
        input.* = std.mem.trimLeft(u8, input.*, &std.ascii.whitespace);
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

    try expectEqualSexprs(expected, actual);
}

test "apply fnk with comptime" {
    var raw_fnk: []const u8 =
        \\ stuff {
        \\      @digit -> (compileMap . ( 
        \\          (0 . ()) 
        \\          (1 . (b1)) 
        \\          (2 . (b0 b1)) 
        \\          (3 . (b1 b1))
        \\      )): @digit;
        \\ }
    ;
    var raw_fnk_compileMap: []const u8 =
        \\ compileMap {
        \\      nil -> nil;
        \\      ((@key . @value) . @rest) -> compileMap: @rest {
        \\          @rest_compiled -> ( ((atom . @key) identity (atom . @value) . return) . @rest_compiled );
        \\      }
        \\ }
    ;
    var raw_input: []const u8 = "2";
    var raw_expected: []const u8 = "(b0 b1)";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    const main_fnk = try parseFnk(&raw_fnk, &pool, std.testing.allocator);
    // defer main_fnk.body.arena.deinit();
    const compiletime_fnk = try parseFnk(&raw_fnk_compileMap, &pool, std.testing.allocator);
    // defer compiletime_fnk.body.arena.deinit();

    const input = try parseSexpr(&raw_input, &pool);
    const expected = try parseSexpr(&raw_expected, &pool);

    var fnk_collection = FnkCollection.init(std.testing.allocator);
    defer fnk_collection.deinit();

    defer {
        var it = fnk_collection.iterator();
        while (it.next()) |x| {
            x.value_ptr.arena.deinit();
        }
    }

    try fnk_collection.put(main_fnk.name, main_fnk.body);
    try fnk_collection.put(compiletime_fnk.name, compiletime_fnk.body);

    const actual = try applyFnk(&fnk_collection, main_fnk.name, &input, std.testing.allocator, &pool, std.testing.allocator);

    try expectEqualSexprs(expected, actual);
}

test "apply another fnk with comptime" {
    var raw_fnk: []const u8 =
        \\ stuff {
        \\      @chars -> (mapEach . helper): @chars;
        \\ }
    ;
    var raw_fnk_compileMap: []const u8 =
        \\ mapEach {
        \\      @fnk_name -> (
        \\          ((atom . nil) identity (atom . nil) . return)
        \\          (((var . first) . (var . rest)) @fnk_name (var . first) . (
        \\              ((var . mapped_first) (mapEach . @fnk_name) (var . rest) . (
        \\                  ((var . mapped_rest) identity ((var . mapped_first) . (var . mapped_rest)) . return)
        \\              ))
        \\          ))
        \\      );
        \\ }
    ;
    var raw_fnk_helper: []const u8 =
        \\ helper {
        \\ a -> 0;
        \\ b -> 1;
        \\ c -> 2;
        \\ }
    ;
    var raw_input: []const u8 = "(a b c b)";
    var raw_expected: []const u8 = "(0 1 2 1)";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    const main_fnk = try parseFnk(&raw_fnk, &pool, std.testing.allocator);
    const compiletime_fnk = try parseFnk(&raw_fnk_compileMap, &pool, std.testing.allocator);
    const helper_fnk = try parseFnk(&raw_fnk_helper, &pool, std.testing.allocator);

    const input = try parseSexpr(&raw_input, &pool);
    const expected = try parseSexpr(&raw_expected, &pool);

    var fnk_collection = FnkCollection.init(std.testing.allocator);
    defer fnk_collection.deinit();

    defer {
        var it = fnk_collection.iterator();
        while (it.next()) |x| {
            x.value_ptr.arena.deinit();
        }
    }

    try fnk_collection.put(main_fnk.name, main_fnk.body);
    try fnk_collection.put(compiletime_fnk.name, compiletime_fnk.body);
    try fnk_collection.put(helper_fnk.name, helper_fnk.body);

    const actual = try applyFnk(&fnk_collection, main_fnk.name, &input, std.testing.allocator, &pool, std.testing.allocator);

    try expectEqualSexprs(expected, actual);
}

fn applyFnk(
    all_fnks: *FnkCollection,
    name: Sexpr,
    input: *const Sexpr,
    temp_bindings_allocator: std.mem.Allocator,
    pool: *MemoryPool(Sexpr),
    allocator_for_new_fnks: std.mem.Allocator,
) error{ OutOfMemory, NO_VALID_MATCH, BAD_INPUT, TODO }!Sexpr {
    if (name.equals(Sexpr.identity)) return input.*;
    if (name.equals(Sexpr.@"eqAtoms?")) return switch (input.*) {
        .atom_lit, .atom_var => Sexpr.fromBool(false),
        .pair => |p| Sexpr.fromBool(p.left.*.isLit() and p.right.*.isLit() and Sexpr.equals(p.left.*, p.right.*)),
    };
    // const fnk = all_fnks.get(name).?;
    const fnk = try findFunktion(all_fnks, name, temp_bindings_allocator, pool, allocator_for_new_fnks);

    // var bindings = std.StringArrayHashMap(*const Sexpr).init(temp_bindings_allocator);
    var bindings = std.ArrayList(Binding).init(temp_bindings_allocator);
    defer bindings.deinit();

    if (DEBUG) {
        const stderr = std.io.getStdErr().writer();
        stderr.print("\napplying fnk with name ", .{}) catch unreachable;
        writeSexpr(name, stderr.any(), allocator_for_new_fnks) catch unreachable;
        stderr.print(" on input ", .{}) catch unreachable;
        writeSexpr(input.*, stderr.any(), allocator_for_new_fnks) catch unreachable;
        stderr.print("\n", .{}) catch unreachable;
    }

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
    if (DEBUG) {
        const stderr = std.io.getStdErr().writer();
        stderr.print("\ntrying to find fnk with name ", .{}) catch unreachable;
        writeSexpr(name, stderr.any(), allocator_for_new_fnks) catch unreachable;
        stderr.print("\n", .{}) catch unreachable;
    }

    if (all_fnks.get(name)) |fnk| {
        return fnk;
    } else switch (name) {
        .atom_lit, .atom_var => return error.BAD_INPUT,
        .pair => |p| {
            // try to compile it!
            const asdf = try applyFnk(all_fnks, p.left.*, p.right, temp_bindings_allocator, pool, allocator_for_new_fnks);
            const cases = try fnkFromSexpr(asdf, allocator_for_new_fnks, pool);
            if (DEBUG) {
                const stderr = std.io.getStdErr().writer();
                stderr.print("\ncompiled a fnk, the cases are: ", .{}) catch unreachable;
                writeSexpr(asdf, stderr.any(), allocator_for_new_fnks) catch unreachable;
                stderr.print("\n", .{}) catch unreachable;
            }
            try all_fnks.put(name, cases);
            return cases;
        },
    }
}

fn fnkFromSexpr(s: Sexpr, allocator_for_new_fnks: std.mem.Allocator, pool: *MemoryPool(Sexpr)) !FnkBody {
    var arena = std.heap.ArenaAllocator.init(allocator_for_new_fnks);
    const cases = (try fnkFromSexprHelper(s, arena.allocator(), pool)).?;
    return .{ .cases = cases, .arena = arena };
}

fn fnkFromSexprHelper(s: Sexpr, arena: std.mem.Allocator, pool: *MemoryPool(Sexpr)) !?InnerCases {
    var cases = std.ArrayListUnmanaged(MatchCaseDefinition){};
    switch (s) {
        .atom_lit => return if (s.equals(Sexpr.@"return")) null else error.BAD_INPUT,
        .atom_var => return error.BAD_INPUT,
        .pair => |p| {
            var cur_parent = p;
            while (true) {
                const cur: Sexpr = cur_parent.left.*;
                const pattern = try internalFromExternal(cur.pair.left, pool);
                const fn_name = cur.pair.right.pair.left.*;
                const template = try internalFromExternal(cur.pair.right.pair.right.pair.left, pool);
                const next = try fnkFromSexprHelper(cur.pair.right.pair.right.pair.right.*, arena, pool);
                try cases.append(arena, .{
                    .pattern = pattern,
                    .fn_name = fn_name,
                    .template = template,
                    .next = next,
                });
                switch (cur_parent.right.*) {
                    .atom_lit => |a| {
                        if (a.equals(Sexpr.nil.atom_lit)) {
                            break;
                        } else {
                            return error.BAD_INPUT;
                        }
                    },
                    .atom_var => return error.BAD_INPUT,
                    .pair => |p2| {
                        cur_parent = p2;
                    },
                }
            }
            return cases;
        },
    }
}

// ((atom . aaa) . (var . bbb)) => (aaa . @bbb)
fn internalFromExternal(s: *const Sexpr, pool: *MemoryPool(Sexpr)) !Sexpr {
    switch (s.*) {
        .atom_var, .atom_lit => return error.BAD_INPUT,
        .pair => |p| {
            if (p.left.equals(Sexpr.atom)) {
                return p.right.*;
            } else if (p.left.equals(Sexpr.@"var")) {
                switch (p.right.*) {
                    .pair => return error.BAD_INPUT,
                    .atom_var => return error.BAD_INPUT,
                    .atom_lit => |a| {
                        const res: *Sexpr = try pool.create();
                        res.* = Sexpr{ .atom_var = a };
                        return res.*;
                    },
                }
            } else {
                const left = try pool.create();
                left.* = try internalFromExternal(p.left, pool);
                const right = try pool.create();
                right.* = try internalFromExternal(p.right, pool);
                return Sexpr{ .pair = Pair{ .left = left, .right = right } };
            }
        },
    }
}

fn applyMatchOptions(
    all_fnks: *FnkCollection,
    cases: InnerCases,
    input: *const Sexpr,
    bindings: *Bindings,
    pool: *MemoryPool(Sexpr),
    allocator_for_new_fnks: std.mem.Allocator,
) !Sexpr {
    const initial_bindings_count = bindings.items.len;
    // defer undoLastBindings(bindings, initial_bindings_count) catch @panic("oops");
    defer undoLastBindings(bindings, initial_bindings_count);
    for (cases.items) |case| {
        if (!try generateBindings(&case.pattern, input, bindings)) {
            undoLastBindings(bindings, initial_bindings_count);
            continue;
        }
        const argument = try fillTemplate(&case.template, bindings, pool);

        if (DEBUG) {
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
        }

        const value = try applyFnk(
            all_fnks,
            case.fn_name,
            argument,
            bindings.allocator,
            pool,
            allocator_for_new_fnks,
        );

        if (DEBUG) {
            const stderr = std.io.getStdErr().writer();
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
        }

        if (case.next) |next| {
            const asdf = try pool.create();
            asdf.* = value;
            return try applyMatchOptions(all_fnks, next, asdf, bindings, pool, allocator_for_new_fnks);
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

const DEBUG = true;

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
        .atom_lit => |expected_atom| switch (actual) {
            .atom_lit => |actual_atom| {
                return std.testing.expectEqualStrings(expected_atom.value, actual_atom.value);
            },
            .atom_var => |actual_atom| {
                std.debug.print("expected literal '{s}' but found variable '{s}'\n", .{ expected_atom.value, actual_atom.value });
                return error.TestExpectedEqual;
            },
            .pair => |actual_pair| {
                std.debug.print("expected literal '{s}' but found a pair {any}\n", .{ expected_atom.value, actual_pair });
                return error.TestExpectedEqual;
            },
        },
        .atom_var => |expected_atom| switch (actual) {
            .atom_lit => |actual_atom| {
                std.debug.print("expected variable '{s}' but found literal '{s}'\n", .{ expected_atom.value, actual_atom.value });
                return error.TestExpectedEqual;
            },
            .atom_var => |actual_atom| {
                return std.testing.expectEqualStrings(expected_atom.value, actual_atom.value);
            },
            .pair => |actual_pair| {
                std.debug.print("expected variable '{s}' but found a pair {any}\n", .{ expected_atom.value, actual_pair });
                return error.TestExpectedEqual;
            },
        },
        .pair => |expected_pair| switch (actual) {
            .atom_lit => |actual_atom| {
                std.debug.print("expected pair but found literal '{s}'\n", .{actual_atom.value});
                return error.TestExpectedEqual;
            },
            .atom_var => |actual_atom| {
                std.debug.print("expected pair but found literal '{s}'\n", .{actual_atom.value});
                return error.TestExpectedEqual;
            },
            .pair => |actual_pair| {
                try expectEqualSexprs(expected_pair.left.*, actual_pair.left.*);
                try expectEqualSexprs(expected_pair.right.*, actual_pair.right.*);
            },
        },
    }
}

const MemStuff = struct {
    temp_bindings_allocator: std.mem.Allocator,
    pool: *MemoryPool(Sexpr),
    state_pool: *MemoryPool(ExecutionState),
    allocator_for_new_fnks: std.mem.Allocator,
};

const ExecutionState = struct {
    cur_value: Sexpr,
    cur_cases: ?InnerCases,
    cur_bindings: Bindings,

    parent: ?*ExecutionState,
    // pub fn next() void {}

    pub fn isDone(this: ExecutionState) bool {
        return this.cur_cases == null and this.parent == null;
    }

    pub fn nextStep(this: *ExecutionState, all_fnks: *FnkCollection, mem: MemStuff) !*ExecutionState {
        if (this.cur_cases) |cases| {
            const initial_bindings_count = this.cur_bindings.items.len;
            for (cases.items) |case| {
                if (!try generateBindings(&case.pattern, &this.cur_value, &this.cur_bindings)) {
                    undoLastBindings(&this.cur_bindings, initial_bindings_count);
                    continue;
                }
                const argument = try fillTemplate(&case.template, &this.cur_bindings, mem.pool);

                var inner_execution = try ExecutionState.start(all_fnks, case.fn_name, argument.*, mem);

                // const value = try applyFnk(
                //     all_fnks,
                //     case.fn_name,
                //     argument,
                //     bindings.allocator,
                //     pool,
                //     allocator_for_new_fnks,
                // );

                if (case.next) |next| {
                    // const asdf = try pool.create();
                    // asdf.* = value;
                    // return try applyMatchOptions(all_fnks, next, asdf, bindings, pool, allocator_for_new_fnks);
                    this.cur_cases = next;
                    this.cur_value = undefined;
                    inner_execution.parent = this;
                    return inner_execution;
                } else {
                    inner_execution.parent = this.parent;
                    this.cur_bindings.deinit();
                    return inner_execution;
                }
            }
            return error.BAD_INPUT;
        } else if (this.parent) |parent| {
            // no cases left
            this.cur_bindings.deinit();
            parent.cur_value = this.cur_value;
            return parent;
        } else {
            return this;
        }
    }

    // TODO: start(input string, fnks string, main allocator)
    pub fn start(all_fnks: *FnkCollection, fn_name: Sexpr, input: Sexpr, mem: MemStuff) !*ExecutionState {
        const bindings = std.ArrayList(Binding).init(mem.temp_bindings_allocator);

        if (fn_name.equals(Sexpr.identity)) {
            const res: ExecutionState = .{
                .cur_value = input,
                .cur_cases = null,
                .cur_bindings = bindings,
                .parent = null,
            };

            const asdf = try mem.state_pool.create();
            asdf.* = res;
            return asdf;
        }
        if (fn_name.equals(Sexpr.@"eqAtoms?")) {
            const val = switch (input) {
                .atom_lit, .atom_var => Sexpr.fromBool(false),
                .pair => |p| Sexpr.fromBool(p.left.*.isLit() and p.right.*.isLit() and Sexpr.equals(p.left.*, p.right.*)),
            };

            const res: ExecutionState = .{
                .cur_value = val,
                .cur_cases = null,
                .cur_bindings = bindings,
                .parent = null,
            };

            const asdf = try mem.state_pool.create();
            asdf.* = res;
            return asdf;
        }

        const fnk = try findFunktion(all_fnks, fn_name, mem.temp_bindings_allocator, mem.pool, mem.allocator_for_new_fnks);

        const res: ExecutionState = .{
            .cur_value = input,
            .cur_cases = fnk.cases,
            .cur_bindings = bindings,
            .parent = null,
        };

        const asdf = try mem.state_pool.create();
        asdf.* = res;
        return asdf;
    }
};

test "apply flat fnk, with ExecutionState" {
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

    var state_pool = MemoryPool(ExecutionState).init(std.testing.allocator);
    defer state_pool.deinit();

    var state = try ExecutionState.start(
        &fnk_collection,
        add_fnk.name,
        input,
        .{
            .pool = &pool,
            .allocator_for_new_fnks = std.testing.allocator,
            .temp_bindings_allocator = std.testing.allocator,
            .state_pool = &state_pool,
        },
    );

    while (!state.isDone()) {
        state = try state.nextStep(&fnk_collection, .{
            .pool = &pool,
            .allocator_for_new_fnks = std.testing.allocator,
            .temp_bindings_allocator = std.testing.allocator,
            .state_pool = &state_pool,
        });
    }

    const actual = state.cur_value;

    try std.testing.expect(Sexpr.equals(expected, actual));
}

test "apply nested fnk, with ExecutionState" {
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

    var state_pool = MemoryPool(ExecutionState).init(std.testing.allocator);
    defer state_pool.deinit();

    var state = try ExecutionState.start(
        &fnk_collection,
        add_fnk.name,
        input,
        .{
            .pool = &pool,
            .allocator_for_new_fnks = std.testing.allocator,
            .temp_bindings_allocator = std.testing.allocator,
            .state_pool = &state_pool,
        },
    );

    while (!state.isDone()) {
        state = try state.nextStep(&fnk_collection, .{
            .pool = &pool,
            .allocator_for_new_fnks = std.testing.allocator,
            .temp_bindings_allocator = std.testing.allocator,
            .state_pool = &state_pool,
        });
    }

    const actual = state.cur_value;

    try std.testing.expect(Sexpr.equals(expected, actual));
}

test "apply fnk with comptime, with ExecutionState" {
    var raw_fnk: []const u8 =
        \\ stuff {
        \\      @digit -> (compileMap . ( 
        \\          (0 . ()) 
        \\          (1 . (b1)) 
        \\          (2 . (b0 b1)) 
        \\          (3 . (b1 b1))
        \\      )): @digit;
        \\ }
    ;
    var raw_fnk_compileMap: []const u8 =
        \\ compileMap {
        \\      nil -> nil;
        \\      ((@key . @value) . @rest) -> compileMap: @rest {
        \\          @rest_compiled -> ( ((atom . @key) identity (atom . @value) . return) . @rest_compiled );
        \\      }
        \\ }
    ;
    var raw_input: []const u8 = "2";
    var raw_expected: []const u8 = "(b0 b1)";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    const main_fnk = try parseFnk(&raw_fnk, &pool, std.testing.allocator);
    // defer main_fnk.body.arena.deinit();
    const compiletime_fnk = try parseFnk(&raw_fnk_compileMap, &pool, std.testing.allocator);
    // defer compiletime_fnk.body.arena.deinit();

    const input = try parseSexpr(&raw_input, &pool);
    const expected = try parseSexpr(&raw_expected, &pool);

    var fnk_collection = FnkCollection.init(std.testing.allocator);
    defer fnk_collection.deinit();

    defer {
        var it = fnk_collection.iterator();
        while (it.next()) |x| {
            x.value_ptr.arena.deinit();
        }
    }

    try fnk_collection.put(main_fnk.name, main_fnk.body);
    try fnk_collection.put(compiletime_fnk.name, compiletime_fnk.body);

    var state_pool = MemoryPool(ExecutionState).init(std.testing.allocator);
    defer state_pool.deinit();

    var state = try ExecutionState.start(
        &fnk_collection,
        main_fnk.name,
        input,
        .{
            .pool = &pool,
            .allocator_for_new_fnks = std.testing.allocator,
            .temp_bindings_allocator = std.testing.allocator,
            .state_pool = &state_pool,
        },
    );
    while (!state.isDone()) {
        state = try state.nextStep(&fnk_collection, .{
            .pool = &pool,
            .allocator_for_new_fnks = std.testing.allocator,
            .temp_bindings_allocator = std.testing.allocator,
            .state_pool = &state_pool,
        });
    }
    const actual = state.cur_value;

    try expectEqualSexprs(expected, actual);
}

test "apply another fnk with comptime, with ExecutionState" {
    var raw_fnk: []const u8 =
        \\ stuff {
        \\      @chars -> (mapEach . helper): @chars;
        \\ }
    ;
    var raw_fnk_compileMap: []const u8 =
        \\ mapEach {
        \\      @fnk_name -> (
        \\          ((atom . nil) identity (atom . nil) . return)
        \\          (((var . first) . (var . rest)) @fnk_name (var . first) . (
        \\              ((var . mapped_first) (mapEach . @fnk_name) (var . rest) . (
        \\                  ((var . mapped_rest) identity ((var . mapped_first) . (var . mapped_rest)) . return)
        \\              ))
        \\          ))
        \\      );
        \\ }
    ;
    var raw_fnk_helper: []const u8 =
        \\ helper {
        \\ a -> 0;
        \\ b -> 1;
        \\ c -> 2;
        \\ }
    ;
    var raw_input: []const u8 = "(a b c b)";
    var raw_expected: []const u8 = "(0 1 2 1)";

    var pool = MemoryPool(Sexpr).init(std.testing.allocator);
    defer pool.deinit();

    const main_fnk = try parseFnk(&raw_fnk, &pool, std.testing.allocator);
    const compiletime_fnk = try parseFnk(&raw_fnk_compileMap, &pool, std.testing.allocator);
    const helper_fnk = try parseFnk(&raw_fnk_helper, &pool, std.testing.allocator);

    const input = try parseSexpr(&raw_input, &pool);
    const expected = try parseSexpr(&raw_expected, &pool);

    var fnk_collection = FnkCollection.init(std.testing.allocator);
    defer fnk_collection.deinit();

    defer {
        var it = fnk_collection.iterator();
        while (it.next()) |x| {
            x.value_ptr.arena.deinit();
        }
    }

    try fnk_collection.put(main_fnk.name, main_fnk.body);
    try fnk_collection.put(compiletime_fnk.name, compiletime_fnk.body);
    try fnk_collection.put(helper_fnk.name, helper_fnk.body);

    var state_pool = MemoryPool(ExecutionState).init(std.testing.allocator);
    defer state_pool.deinit();

    var state = try ExecutionState.start(
        &fnk_collection,
        main_fnk.name,
        input,
        .{
            .pool = &pool,
            .allocator_for_new_fnks = std.testing.allocator,
            .temp_bindings_allocator = std.testing.allocator,
            .state_pool = &state_pool,
        },
    );
    while (!state.isDone()) {
        state = try state.nextStep(&fnk_collection, .{
            .pool = &pool,
            .allocator_for_new_fnks = std.testing.allocator,
            .temp_bindings_allocator = std.testing.allocator,
            .state_pool = &state_pool,
        });
    }
    const actual = state.cur_value;

    try expectEqualSexprs(expected, actual);
}
