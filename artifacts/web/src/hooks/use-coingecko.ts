import { useQuery } from "@tanstack/react-query";

export interface CoinGeckoCoin {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  total_volume: number;
  price_change_percentage_1h_in_currency: number;
  price_change_percentage_24h_in_currency: number;
}

const fetchPage = async (page: number): Promise<CoinGeckoCoin[]> => {
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false&price_change_percentage=1h%2C24h`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    if (res.status === 429) throw new Error("Rate limited by CoinGecko");
    throw new Error("Failed to fetch CoinGecko data");
  }
  return res.json();
};

export function useTop500Coins() {
  return useQuery({
    queryKey: ["coingecko-top500"],
    queryFn: async () => {
      const page1 = await fetchPage(1);
      await new Promise(r => setTimeout(r, 1500));
      const page2 = await fetchPage(2);
      return [...page1, ...page2];
    },
    staleTime: 120 * 1000,
    refetchInterval: 120 * 1000,
    retry: (failureCount, error) => {
      if (error.message.includes("Rate limited")) return false;
      return failureCount < 3;
    }
  });
}
