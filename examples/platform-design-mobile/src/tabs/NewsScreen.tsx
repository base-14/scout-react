import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
const ARTICLES = [
    {
        title: 'OpenTelemetry 2.x lands for JavaScript',
        excerpt: 'The browser SDK gains a stable resource API and a logs pipeline.',
    },
    {
        title: 'Your dashboard, one shape for web and mobile',
        excerpt: 'Same attribute keys, one collector, two SDKs.',
    },
    {
        title: 'Crash detection without native code',
        excerpt: 'Session-marker checkpoints survive OOM kills.',
    },
];
export function NewsScreen() {
    return (<ScrollView style={styles.container} contentContainerStyle={{ padding: 12 }}>
      {ARTICLES.map((a, i) => (<Pressable key={i} accessibilityLabel={`Open ${a.title}`} style={styles.card}>
          <Text style={styles.title}>{a.title}</Text>
          <Text style={styles.sub}>{a.excerpt}</Text>
        </Pressable>))}
    </ScrollView>);
}
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fafafa' },
    card: {
        backgroundColor: '#fff',
        padding: 16,
        borderRadius: 8,
        marginBottom: 8,
        elevation: 2,
    },
    title: { fontSize: 16, fontWeight: '600' },
    sub: { fontSize: 13, color: '#757575', marginTop: 4 },
});
