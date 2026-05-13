import { Pressable, StyleSheet, Text, View } from 'react-native';
export function DiagnosticsPanel() {
    return (<View style={styles.card}>
      <Text style={styles.h}>Diagnostics</Text>
      <Text style={styles.body}>
        Each button drives a real event. scout-react's auto-instrumentation captures
        it. Tail the dev machine's collector log to verify.
      </Text>
      <View style={styles.grid}>
        <Btn label="fetch (200)" onPress={() => {
            void fetch('http://localhost:34318/').catch(() => { });
        }}/>
        <Btn label="fetch (network err)" onPress={() => {
            void fetch('http://localhost:9/never-listens').catch(() => { });
        }}/>
        <Btn label="throw async" variant="danger" onPress={() => {
            setTimeout(() => {
                throw new Error('async uncaught error from RN');
            }, 0);
        }}/>
        <Btn label="unhandled rejection" variant="danger" onPress={() => {
            void Promise.reject(new Error('unhandled rejection demo'));
        }}/>
        <Btn label="long task (250ms)" variant="danger" onPress={() => {
            const end = Date.now() + 250;
            while (Date.now() < end) {
            }
        }}/>
        <Btn label="anr (6s freeze)" variant="danger" onPress={() => {
            const end = Date.now() + 6000;
            while (Date.now() < end) {
            }
        }}/>
        <Btn label="render error" variant="danger" onPress={() => {
            (undefined as any).neverPropertyAccess.crash();
        }}/>
        <Btn label="fatal (red box)" variant="danger" onPress={() => {
            const g: any = globalThis;
            const err = new Error('synthetic fatal crash');
            if (g.ErrorUtils?.reportFatalError)
                g.ErrorUtils.reportFatalError(err);
            else
                throw err;
        }}/>
        <Btn label="native NSException" variant="danger" onPress={() => {
            try {
                const ExpoModules = require('expo-modules-core');
                const ScoutCrash = ExpoModules?.requireOptionalNativeModule?.('ScoutCrash');
                if (ScoutCrash?.crashNow) {
                    void ScoutCrash.crashNow('triggered from diagnostics panel');
                }
            }
            catch {
            }
        }}/>
        <Btn label="complete app crash" variant="danger" onPress={() => {
            const g: any = globalThis;
            const err = new Error('intentional complete crash — verify app_crash on next launch');
            if (g.ErrorUtils?.reportFatalError) {
                g.ErrorUtils.reportFatalError(err);
            }
            setTimeout(() => {
                while (true) {
                    throw err;
                }
            }, 100);
        }}/>
      </View>
    </View>);
}
function Btn({ label, onPress, variant = 'primary', }: {
    label: string;
    onPress: () => void;
    variant?: 'primary' | 'danger';
}) {
    const bg = variant === 'danger' ? '#c62828' : '#2e7d32';
    return (<Pressable accessibilityLabel={label} style={[styles.btn, { backgroundColor: bg }]} onPress={onPress}>
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>);
}
const styles = StyleSheet.create({
    card: { backgroundColor: '#fff', padding: 12, borderRadius: 8, marginBottom: 8 },
    h: { fontSize: 18, fontWeight: '600', marginBottom: 4 },
    body: { fontSize: 13, color: '#616161', marginBottom: 12 },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    btn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 4, margin: 4 },
    btnText: { color: '#fff', fontSize: 13, fontWeight: '500' },
});
