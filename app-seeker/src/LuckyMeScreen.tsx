import React, { useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";

type Pool = {
  id: "mini" | "normal" | "high";
  label: string;
  ticketPriceSol: string;
};

const POOLS: Pool[] = [
  { id: "mini", label: "Mini", ticketPriceSol: "0.005" },
  { id: "normal", label: "Normal", ticketPriceSol: "0.01" },
  { id: "high", label: "High", ticketPriceSol: "0.1" },
];

export function LuckyMeScreen() {
  const [selectedPool, setSelectedPool] = useState<Pool>(POOLS[1]);
  const [ticketCount, setTicketCount] = useState(1);

  const estimatedChance = useMemo(() => {
    const currentTickets = 38;
    return ((ticketCount / (currentTickets + ticketCount)) * 100).toFixed(2);
  }, [ticketCount]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>LuckyMe</Text>
          <Text style={styles.subtitle}>5 minute Solana luck pools</Text>
        </View>

        <FlatList
          data={POOLS}
          keyExtractor={(item) => item.id}
          horizontal
          contentContainerStyle={styles.poolList}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => setSelectedPool(item)}
              style={[
                styles.poolButton,
                selectedPool.id === item.id && styles.poolButtonSelected,
              ]}
            >
              <Text style={styles.poolLabel}>{item.label}</Text>
              <Text style={styles.poolPrice}>{item.ticketPriceSol} SOL</Text>
            </Pressable>
          )}
        />

        <View style={styles.roundPanel}>
          <View style={styles.row}>
            <Text style={styles.label}>Active pool</Text>
            <Text style={styles.value}>{selectedPool.label}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Ticket</Text>
            <Text style={styles.value}>{selectedPool.ticketPriceSol} SOL</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Round ends</Text>
            <Text style={styles.value}>03:42</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Your chance</Text>
            <Text style={styles.value}>{estimatedChance}%</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Split</Text>
            <Text style={styles.value}>95 / 3 / 2</Text>
          </View>
        </View>

        <View style={styles.stepper}>
          <Pressable
            style={styles.stepperButton}
            onPress={() => setTicketCount(Math.max(1, ticketCount - 1))}
          >
            <Text style={styles.stepperText}>-</Text>
          </Pressable>
          <Text style={styles.ticketCount}>{ticketCount}</Text>
          <Pressable
            style={styles.stepperButton}
            onPress={() => setTicketCount(ticketCount + 1)}
          >
            <Text style={styles.stepperText}>+</Text>
          </Pressable>
        </View>

        <Pressable style={styles.joinButton}>
          <Text style={styles.joinText}>Join round</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#101316",
  },
  screen: {
    flex: 1,
    gap: 18,
    padding: 20,
  },
  header: {
    gap: 4,
  },
  title: {
    color: "#f7f3ea",
    fontSize: 34,
    fontWeight: "800",
  },
  subtitle: {
    color: "#98a2ad",
    fontSize: 15,
  },
  poolList: {
    gap: 10,
  },
  poolButton: {
    width: 118,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2d343b",
    backgroundColor: "#171b20",
    padding: 14,
  },
  poolButtonSelected: {
    borderColor: "#f2b84b",
    backgroundColor: "#241f15",
  },
  poolLabel: {
    color: "#f7f3ea",
    fontSize: 16,
    fontWeight: "700",
  },
  poolPrice: {
    color: "#98a2ad",
    marginTop: 8,
  },
  roundPanel: {
    gap: 14,
    borderRadius: 8,
    backgroundColor: "#171b20",
    padding: 16,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  label: {
    color: "#98a2ad",
    fontSize: 14,
  },
  value: {
    color: "#f7f3ea",
    fontSize: 15,
    fontWeight: "700",
  },
  stepper: {
    alignItems: "center",
    flexDirection: "row",
    gap: 18,
    justifyContent: "center",
  },
  stepperButton: {
    alignItems: "center",
    backgroundColor: "#252b31",
    borderRadius: 24,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  stepperText: {
    color: "#f7f3ea",
    fontSize: 26,
    fontWeight: "800",
  },
  ticketCount: {
    color: "#f7f3ea",
    fontSize: 28,
    fontWeight: "800",
    minWidth: 54,
    textAlign: "center",
  },
  joinButton: {
    alignItems: "center",
    backgroundColor: "#f2b84b",
    borderRadius: 8,
    marginTop: "auto",
    paddingVertical: 16,
  },
  joinText: {
    color: "#17120a",
    fontSize: 17,
    fontWeight: "800",
  },
});
