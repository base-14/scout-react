module.exports = function (api) {
    api.cache(true);
    return {
        presets: ['babel-preset-expo'],
        plugins: ['@base-14/scout-react/babel-plugin'],
    };
};
