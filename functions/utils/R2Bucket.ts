async function saveToBucket(bucket: any, domain: string, body: Record<string, any>) {
  if(!bucket) {
    console.warn(`No bucket found for env.EVENT_BUCKET`);
    return;
  }

  try {
    const isoDate = new Date().toISOString();
    const key = `${domain}/lifecycle/${isoDate}.json`;
    console.log(`Writing to ${key}`);
    console.log(`env.EVENT_BUCKET:`, bucket);

    return await bucket.put(key, JSON.stringify(body));
  } catch (e) {
    console.error(`Error saving to bucket: ${e}`);
  }
}

export {saveToBucket};
