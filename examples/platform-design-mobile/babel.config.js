module.exports = function (api) {
    api.cache(true);
    return {
        presets: ['babel-preset-expo'],
        plugins: ['@base14/scout-react/babel-plugin'],
    };
};
