import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
const SONGS = [
    { id: '1', title: 'Echoes of Tomorrow', artist: 'Aurora Skies', duration: '4:12' },
    { id: '2', title: 'Midnight Lattice', artist: 'Lumen Drift', duration: '3:38' },
    { id: '3', title: 'Quiet Static', artist: 'Pale Continent', duration: '5:01' },
    { id: '4', title: 'Glasswater', artist: 'Halcyon', duration: '3:51' },
    { id: '5', title: 'Northbound', artist: 'Long Way Home', duration: '4:27' },
    { id: '6', title: 'Heat Bloom', artist: 'Velvet Tigers', duration: '2:58' },
    { id: '7', title: 'Paper Cranes', artist: 'Origami Sky', duration: '4:05' },
    { id: '8', title: 'Slow Tides', artist: 'Aqua Marine', duration: '5:21' },
    { id: '9', title: 'Cinder Fields', artist: 'Ash & Ember', duration: '3:44' },
    { id: '10', title: 'Aurora', artist: 'North Lights', duration: '4:48' },
    { id: '11', title: 'Bone & Brass', artist: 'Iron Choir', duration: '3:30' },
    { id: '12', title: 'Driftless', artist: 'Nomad Hearts', duration: '4:55' },
    { id: '13', title: 'Salt Air', artist: 'Coastal Drift', duration: '3:17' },
    { id: '14', title: 'Compass Rose', artist: 'Wanderer', duration: '4:33' },
    { id: '15', title: 'Lantern Light', artist: 'Ember Glow', duration: '3:52' },
    { id: '16', title: 'Iron Sky', artist: 'Hammer Strike', duration: '4:11' },
    { id: '17', title: 'Velvet Hour', artist: 'Midnight Mauve', duration: '5:08' },
    { id: '18', title: 'Wildflower', artist: 'Meadow', duration: '3:23' },
    { id: '19', title: 'Long Shadow', artist: 'Sundown', duration: '4:19' },
    { id: '20', title: 'Quiet Riot', artist: 'Hush Pop', duration: '2:47' },
    { id: '21', title: 'Tin Sun', artist: 'Foil & Wire', duration: '3:34' },
    { id: '22', title: 'River Bend', artist: 'Currents', duration: '4:41' },
    { id: '23', title: 'High Wire', artist: 'Trapeze', duration: '3:58' },
    { id: '24', title: 'Pale Horse', artist: 'Riders', duration: '4:26' },
    { id: '25', title: 'Granite', artist: 'Stone Set', duration: '3:49' },
    { id: '26', title: 'Floodlights', artist: 'Stadium', duration: '4:02' },
    { id: '27', title: 'Soft Static', artist: 'Pale Continent', duration: '5:14' },
    { id: '28', title: 'Compass North', artist: 'True Bearing', duration: '3:36' },
    { id: '29', title: 'Tape Hiss', artist: 'Magnetic', duration: '4:09' },
    { id: '30', title: 'Last Train', artist: 'Platform 9', duration: '5:00' },
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
