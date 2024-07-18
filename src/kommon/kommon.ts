import { in01, mod, remap } from './math';

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

export function eqArrays<T>(a: T[], b: T[]): boolean {
    return a.length === b.length && a.every((v, k) => v === b[k]);
}

export function eqArraysWithFn<T>(a: T[], b: T[], equal: (x: T, y: T) => boolean): boolean {
    return a.length === b.length && a.every((v, k) => equal(v, b[k]));
}

export function reversed<T>(array: T[]) {
    return array.map((_item, idx) => array[array.length - 1 - idx]);
}

export function commonPrefixLen<T>(arr1: T[], arr2: T[]): number {
    let result = 0;
    while (result < Math.min(arr1.length, arr2.length)) {
        if (arr1[result] !== arr2[result]) {
            break;
        }
        result += 1;
    }
    return result;
}

export function reversedForEach<T>(arr: T[], callback: (value: T, index?: number, obj?: T[]) => void): void {
    for (let k = arr.length - 1; k >= 0; k--) {
        callback(arr[k], k, arr);
    }
}

export function findIndex<T>(arr: T[], predicate: (value: T, index?: number, obj?: T[]) => boolean): number | null {
    const index = arr.findIndex(predicate);
    if (index < 0) return null;
    return index;
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

export function* enumerate<T>(array: Iterable<T>): Generator<[number, T]> {
    const iterator = array[Symbol.iterator]();
    let k = 0;
    while (true) {
        const next = iterator.next();
        if (next.done ?? false) return;
        yield [k, next.value];
        k += 1;
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

export function* zip3<T, S, K>(array1: Iterable<T>, array2: Iterable<S>, array3: Iterable<K>): Generator<[T, S, K]> {
    const iterator1 = array1[Symbol.iterator]();
    const iterator2 = array2[Symbol.iterator]();
    const iterator3 = array3[Symbol.iterator]();
    while (true) {
        const next1 = iterator1.next();
        const next2 = iterator2.next();
        const next3 = iterator3.next();
        const done = (next1.done ?? false) || (next2.done ?? false) || (next3.done ?? false);
        if (done) return;
        yield [next1.value, next2.value, next3.value];
    }
}

export function* zip4<T, S, K, Q>(
    array1: Iterable<T>,
    array2: Iterable<S>,
    array3: Iterable<K>,
    array4: Iterable<Q>,
): Generator<[T, S, K, Q]> {
    const iterator1 = array1[Symbol.iterator]();
    const iterator2 = array2[Symbol.iterator]();
    const iterator3 = array3[Symbol.iterator]();
    const iterator4 = array4[Symbol.iterator]();
    while (true) {
        const next1 = iterator1.next();
        const next2 = iterator2.next();
        const next3 = iterator3.next();
        const next4 = iterator4.next();
        const done = (next1.done ?? false) || (next2.done ?? false) || (next3.done ?? false) || (next4.done ?? false);
        if (done) return;
        yield [next1.value, next2.value, next3.value, next4.value];
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function* zip<T extends Array<any>>(
    ...toZip: { [K in keyof T]: Iterable<T[K]> }
): Generator<T> {
    const iterators = toZip.map(i => i[Symbol.iterator]());

    while (true) {
        const results = iterators.map(i => i.next());
        // If any of the iterators are done, we should stop.
        if (results.some(({ done }) => done)) {
            break;
        }
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-unsafe-return
        yield results.map(({ value }) => value) as T;
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

export class DefaultMapExtra<K, Q, V> {
    constructor(
        private serialize_key: (key: K) => Q,
        private init_fn: (key: K) => V,
        public inner_map = new Map<Q, V>(),
    ) { }

    get(key: K): V {
        const real_key = this.serialize_key(key);
        let result = this.inner_map.get(real_key);
        if (result === undefined) {
            result = this.init_fn(key);
            this.inner_map.set(real_key, result);
        }
        return result;
    }

    set(key: K, value: V): void {
        this.inner_map.set(this.serialize_key(key), value);
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
                }
                else {
                    target[name] = init_fn();
                    return target[name];
                }
            },
        });
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

    return `#${((rr << 16) + (rg << 8) + (rb | 0)).toString(16).padStart(6, '0').slice(-6)}`;
}

export function single<T>(arr: T[]): T {
    if (arr.length === 0) {
        throw new Error('the array was empty');
    }
    else if (arr.length > 1) {
        throw new Error(`the array had more than 1 element: ${arr.toString()}`);
    }
    else {
        return arr[0];
    }
}

export function at<T>(arr: T[], index: number): T {
    if (arr.length === 0) throw new Error('can\'t call \'at\' with empty array');
    if (index >= arr.length) throw new Error('index out of bounds');
    if (index < -arr.length) throw new Error('negative index out of bounds');
    return arr[mod(index, arr.length)];
}

export function or(a: boolean, b: boolean): boolean {
    return a || b;
}

export function last<T>(arr: T[]): T {
    if (arr.length === 0) throw new Error('can\'t call \'last\' with empty array');
    return arr[arr.length - 1];
}

// Return new array with element [index] changed to new_element
export function replace<T>(arr: T[], new_element: T, index: number): T[] {
    const result = [...arr];
    result[index] = new_element;
    return result;
}

// Return new array without element [index]
export function deleteAt<T>(arr: T[], index: number): T[] {
    const result = [...arr];
    result.splice(index, 1);
    return result;
}

// Return new array with new_element added at [index]
export function addAt<T>(arr: T[], new_element: T, index: number): T[] {
    const result = [...arr];
    result.splice(index, 0, new_element);
    return result;
}

export function assertNotNull<T>(element: T | null): T {
    if (element === null) throw new Error('assertNotNull got a null');
    return element;
}

export function assert(shouldBeTrue: boolean, msg?: string): void {
    if (!shouldBeTrue) {
        throw new Error(msg ?? 'failed assertion');
    }
}

export function getFromStorage<T>(key_name: string, if_found: (value: string) => T, if_not: T): T {
    const str = localStorage.getItem(key_name);
    if (str === null) {
        return if_not;
    }
    else {
        return if_found(str);
    }
}

export function subdivideT<T>(t: number, ranges: [number, number, (t: number) => T][]): T {
    for (const range of ranges) {
        const local_t = remap(t, range[0], range[1], 0, 1);
        if (in01(local_t)) {
            return range[2](local_t);
        }
    }
    throw new Error('no matching range');
}

/** Only for Vite, and only for reference! you must paste it into your script :( */
// function absoluteUrl(url: string): string {
//     return new URL(url, import.meta.url).href;
// }
