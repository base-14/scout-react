import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
const ROWS = [
    { key: 'autoplay', label: 'Autoplay' },
    { key: 'wifi', label: 'WiFi only downloads' },
    { key: 'beta', label: 'Beta features' },
    { key: 'notifications', label: 'Push notifications' },
];
export function SettingsScreen() {
    const [state, setState] = useState<Record<string, boolean>>({
        autoplay: true,
        wifi: false,
        beta: false,
        notifications: true,
    });
    return (<ScrollView style={styles.container} contentContainerStyle={{ padding: 12 }}>
      <View style={styles.card}>
        {ROWS.map((r, i) => (<View key={r.key} style={[styles.row, i === ROWS.length - 1 && styles.lastRow]}>
            <Text style={styles.label}>{r.label}</Text>
            <Switch value={state[r.key]} onValueChange={(v) => setState((s) => ({ ...s, [r.key]: v }))}/>
          </View>))}
      </View>
    </ScrollView>);
}
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fafafa' },
    card: { backgroundColor: '#fff', borderRadius: 8 },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    lastRow: { borderBottomWidth: 0 },
    label: { fontSize: 15 },
});
