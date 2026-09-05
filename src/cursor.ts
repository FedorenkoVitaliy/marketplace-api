import type { Request } from 'express';

type QueryValue = Request['query'][string];

export const getCurrentCursor = (cursor: QueryValue) => {
    return typeof cursor === 'string'
        ? Number(Buffer.from(cursor, 'base64url').toString())
        : 0;
};

export const getNextCursor = (cursor: number, length: number) => {
    return cursor < length
        ? Buffer.from(String(cursor)).toString('base64url')
        : null;
};
