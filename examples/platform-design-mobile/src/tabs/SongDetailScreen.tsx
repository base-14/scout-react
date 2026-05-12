import { Pressable, StyleSheet, Text, View } from 'react-native';
export function SongDetailScreen({ route }: any) {
    const { id, title } = route.params ?? {};
    return (<View style={styles.container}>
      <Text style={styles.h}>Song #{id}</Text>
      <Text style={styles.t}>{title}</Text>
      <Text style={styles.body}>
        Pushing this screen emits a screen_view span. Popping it emits a view_session
        span with the time spent.
      </Text>
      <Pressable accessibilityLabel="Play song" style={styles.btn}>
        <Text style={styles.btnText}>Play</Text>
      </Pressable>
    </View>);
}
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fafafa', padding: 16 },
    h: { fontSize: 22, fontWeight: '600' },
    t: { fontSize: 16, marginTop: 4, color: '#424242' },
    body: { fontSize: 14, color: '#616161', marginTop: 12 },
    btn: {
        marginTop: 16,
        backgroundColor: '#2e7d32',
        paddingVertical: 10,
        paddingHorizontal: 18,
        borderRadius: 6,
        alignSelf: 'flex-start',
    },
    btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
