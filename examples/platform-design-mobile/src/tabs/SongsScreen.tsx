import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
const SONGS = [
    { id: '1', title: 'Echoes of Tomorrow', artist: 'Aurora Skies', duration: '4:12' },
    { id: '2', title: 'Midnight Lattice', artist: 'Lumen Drift', duration: '3:38' },
    { id: '3', title: 'Quiet Static', artist: 'Pale Continent', duration: '5:01' },
    { id: '4', title: 'Glasswater', artist: 'Halcyon', duration: '3:51' },
    { id: '5', title: 'Northbound', artist: 'Long Way Home', duration: '4:27' },
    { id: '6', title: 'Heat Bloom', artist: 'Velvet Tigers', duration: '2:58' },
];
export function SongsScreen({ navigation }: any) {
    return (<View style={styles.container}>
      <FlatList data={SONGS} keyExtractor={(s) => s.id} renderItem={({ item }) => (<Pressable accessibilityLabel={`Open ${item.title}`} onPress={() => navigation.navigate('SongDetail', { id: item.id, title: item.title })} style={styles.card}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.sub}>
              {item.artist} · {item.duration}
            </Text>
          </Pressable>)}/>
    </View>);
}
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fafafa', padding: 12 },
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
