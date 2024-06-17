import Rand from 'rand-seed';

export class Random {
    private rand: Rand;
    constructor(seed?: string) {
        this.rand = new Rand(seed);
    }

    float(low_inclusive: number, high_exclusive: number): number {
        return low_inclusive + this.rand.next() * (high_exclusive - low_inclusive);
    }

    int(low_inclusive: number, high_exclusive: number): number {
        return low_inclusive + Math.floor(this.rand.next() * (high_exclusive - low_inclusive));
    }

    // from https://stackoverflow.com/questions/2450954/how-to-randomize-shuffle-a-javascript-array
    shuffle<T>(array: T[]): T[] {
        let currentIndex = array.length, randomIndex;
        // While there remain elements to shuffle.
        while (currentIndex != 0) {
            // Pick a remaining element.
            randomIndex = Math.floor(this.rand.next() * currentIndex);
            currentIndex--;
            // And swap it with the current element.
            [array[currentIndex], array[randomIndex]] = [
                array[randomIndex], array[currentIndex],
            ];
        }
        return array;
    }

    choiceWithoutRepeat<T>(arr: T[], count: number) {
        if (count > arr.length) {
            throw new Error('array too small or count too big');
        }
        const result: T[] = [];
        while (result.length < count) {
            const cur = this.choice(arr);
            if (!result.includes(cur)) {
                result.push(cur);
            }
        }
        return result;
    }

    choice<T>(arr: T[]) {
        if (arr.length === 0) {
            throw new Error('can\'t choose out of an empty array');
        }
        return arr[Math.floor(this.rand.next() * arr.length)];
    }
}
