import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Scout from '@base14/scout-react/native';
import { DiagnosticsPanel } from '../components/DiagnosticsPanel';
export function ProfileScreen() {
    return (<ScrollView style={styles.container} contentContainerStyle={{ padding: 12 }}>
      <View style={styles.card}>
        <Text style={styles.h}>Profile</Text>
        <Row label="User ID" value={Scout.userId ?? '—'}/>
        <Row label="Session" value={(Scout.sessionId ?? '—').slice(0, 8)}/>
      </View>
      <DiagnosticsPanel />
    </ScrollView>);
}
function Row({ label, value }: {
    label: string;
    value: string;
}) {
    return (<View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>);
}
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fafafa' },
    card: { backgroundColor: '#fff', padding: 16, borderRadius: 8, marginBottom: 8 },
    h: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
    row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
    label: { color: '#757575' },
    value: { fontWeight: '500' },
});
