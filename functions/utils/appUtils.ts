const liteKeySuffix = '-lite';

export const isLite = (appKey: string): boolean => {
  return appKey.includes(liteKeySuffix);
};
