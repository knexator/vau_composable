import * as fs from 'fs';
import * as path from 'path';
import { applyFunktion, parseFnks, parseSexprLiteral, sexprToString } from './model';

function fileContents(filePath: string | undefined): string {
    if (filePath === undefined) {
        console.error('Error: Please provide a file path as a command-line argument.');
        process.exit(1);
    }
    const resolvedPath = path.resolve(filePath);
    return fs.readFileSync(resolvedPath, 'utf8');
}

const all_fnks = parseFnks(fileContents(process.argv[2]), '@');
const result = applyFunktion(all_fnks, parseSexprLiteral(process.argv[3], '@'), parseSexprLiteral(process.argv[4], '@'));
console.log(sexprToString(result, '@'));
