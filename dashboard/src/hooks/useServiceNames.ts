import { useEffect, useState } from 'react';
import { fetchServiceNames } from '@/lib/api';

export function useServiceNames(): string[] {
  const [serviceNames, setServiceNames] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const names = await fetchServiceNames();
        if (active) setServiceNames(names);
      } catch (error) {
        console.error('Failed to fetch service names', error);
      }
    };

    load();
    const interval = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return serviceNames;
}
