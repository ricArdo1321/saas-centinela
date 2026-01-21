import { useState, useEffect } from 'react';

/**
 * A simple data fetching hook for React.
 * Similar to a minimal version of React Query.
 *
 * @param key - A unique key for the query (triggers refetch on change)
 * @param fetcher - An async function that returns the data
 */
export function useQuery<T>(key: string, fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setError(null);

    fetcher()
      .then(res => {
        if (isMounted) {
          setData(res);
          setIsLoading(false);
        }
      })
      .catch(err => {
        if (isMounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [key]);

  return { data, isLoading, error };
}
