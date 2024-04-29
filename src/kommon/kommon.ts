// export function deepcopy<T>(thing: T): T {
//     // TODO: lots to do
//     if (Array.isArray(thing)) {
//         // @ts-ignore
//         return thing.map(x => deepcopy(x));
//     } else {
//         return thing;
//     }
// }

export function fromCount<T>(n: number, callback: (index: number) => T): T[] {
    const result: T[] = [];
    for (let k = 0; k < n; k++) {
        result.push(callback(k));
    }
    return result;
}

export function repeat<T>(n: number, thing: T): T[] {
    return Array<T>(n).fill(thing);
}

export function fromRange<T>(lo: number, hi: number, callback: (index: number) => T): T[] {
    const count = hi - lo;
    const result: T[] = [];
    for (let k = 0; k < count; k++) {
        result.push(callback(k + lo));
    }
    return result;
}

export function* pairwise<T>(arr: Iterable<T>): Generator<[T, T], void, void> {
    const iterator = arr[Symbol.iterator]();
    let a = iterator.next();
    if (a.done === true) return; // zero elements
    let b = iterator.next();
    if (b.done === true) return; // one element 
    while (b.done !== true) {
        yield [a.value, b.value];
        a = b;
        b = iterator.next();
    }
}

export function* zip2<T, S>(array1: Iterable<T>, array2: Iterable<S>): Generator<[T, S]> {
    const iterator1 = array1[Symbol.iterator]();
    const iterator2 = array2[Symbol.iterator]();
    while (true) {
        const next1 = iterator1.next();
        const next2 = iterator2.next();
        const done = (next1.done ?? false) || (next2.done ?? false);
        if (done) return;
        yield [next1.value, next2.value];
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function* zip<T extends Array<any>>(
    ...toZip: { [K in keyof T]: Iterable<T[K]> }
): Generator<T> {
    const iterators = toZip.map(i => i[Symbol.iterator]())

    while (true) {
        const results = iterators.map(i => i.next())
        // If any of the iterators are done, we should stop.
        if (results.some(({ done }) => done)) {
            break
        }
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-unsafe-return
        yield results.map(({ value }) => value) as T
    }
}

export function objectMap<T, S>(object: Record<string, T>, map_fn: (x: T) => S): Record<string, S> {
    const result: Record<string, S> = {};
    for (const [k, v] of Object.entries(object)) {
        result[k] = map_fn(v);
    }
    return result;
}

export class DefaultMap<K, V> {
    constructor(
        private init_fn: (key: K) => V,
        public inner_map = new Map<K, V>(),
    ) { }

    get(key: K): V {
        let result = this.inner_map.get(key);
        if (result === undefined) {
            result = this.init_fn(key);
            this.inner_map.set(key, result);
        }
        return result;
    }

    set(key: K, value: V): void {
        this.inner_map.set(key, value);
    }
}


export class DefaultDict<T> {
    constructor(init_fn: () => T) {
        // typing doesn't work :(
        const target: Record<string | symbol | number, T> = {};
        return new Proxy(target, {
            get: (target, name): T => {
                if (name in target) {
                    return target[name];
                } else {
                    target[name] = init_fn();
                    return target[name];
                }
            }
        })
    }
}

// from https://gist.github.com/rosszurowski/67f04465c424a9bc0dae
// and https://gist.github.com/nikolas/b0cce2261f1382159b507dd492e1ceef
export function lerpHexColor(a: string, b: string, t: number): string {
    const ah = Number(a.replace('#', '0x'));
    const bh = Number(b.replace('#', '0x'));

    const ar = (ah & 0xFF0000) >> 16,
        ag = (ah & 0x00FF00) >> 8,
        ab = (ah & 0x0000FF),

        br = (bh & 0xFF0000) >> 16,
        bg = (bh & 0x00FF00) >> 8,
        bb = (bh & 0x0000FF),

        rr = ar + t * (br - ar),
        rg = ag + t * (bg - ag),
        rb = ab + t * (bb - ab);


    return `#${((rr << 16) + (rg << 8) + (rb | 0)).toString(16).padStart(6, '0').slice(-6)}`
}

/** Only for Vite, and only for reference! you must paste it into your script :( */
// function absoluteUrl(url: string): string {
//     return new URL(url, import.meta.url).href;
// }
