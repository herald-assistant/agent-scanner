import {mkdir,copyFile} from 'node:fs/promises';

const directory=new URL('../src/generated-assets/optimization/',import.meta.url);
await mkdir(directory,{recursive: true});
await copyFile(new URL('../../src/main/resources/optimization/techniques-v1.json',import.meta.url),new URL('techniques-v1.json',directory));
