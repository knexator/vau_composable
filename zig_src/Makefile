run:
	@zig build -Dtarget=wasm32-wasi
	@wasmtime .\zig-out\bin\zig_src.wasm 'hola buenas'
