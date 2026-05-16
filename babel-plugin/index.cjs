const DEFAULT_COMPONENTS = [
    'Pressable',
    'TouchableOpacity',
    'TouchableHighlight',
    'TouchableWithoutFeedback',
    'TouchableNativeFeedback',
    'Button',
];
const DEFAULT_HANDLERS = ['onPress', 'onLongPress'];
const WRAPPED_MARKER = '__scoutWrapped';
module.exports = function scoutBabelPlugin(babel) {
    const { types: t } = babel;
    const getStringAttribute = (openingElement, name) => {
        const attr = openingElement.attributes.find((a) => t.isJSXAttribute(a) && a.name && a.name.name === name);
        if (!attr || !attr.value)
            return null;
        if (t.isStringLiteral(attr.value))
            return attr.value.value;
        if (t.isJSXExpressionContainer(attr.value) && t.isStringLiteral(attr.value.expression)) {
            return attr.value.expression.value;
        }
        return null;
    };
    const getStaticTextChild = (element) => {
        if (!element.children || element.children.length === 0)
            return null;
        for (const c of element.children) {
            if (t.isJSXText(c)) {
                const trimmed = c.value.trim();
                if (trimmed)
                    return trimmed.slice(0, 60);
            }
            if (t.isJSXExpressionContainer(c) &&
                t.isStringLiteral(c.expression)) {
                return c.expression.value.slice(0, 60);
            }
        }
        return null;
    };
    const buildWrappedHandler = (originalExpr, descriptor) => {
        const argsId = t.identifier('$scoutArgs');
        const descriptorObj = t.objectExpression([
            t.objectProperty(t.identifier('componentName'), t.stringLiteral(descriptor.componentName)),
            t.objectProperty(t.identifier('accessibilityLabel'), descriptor.accessibilityLabel != null
                ? t.stringLiteral(descriptor.accessibilityLabel)
                : t.identifier('undefined')),
            t.objectProperty(t.identifier('testID'), descriptor.testID != null
                ? t.stringLiteral(descriptor.testID)
                : t.identifier('undefined')),
            t.objectProperty(t.identifier('children'), descriptor.children != null
                ? t.stringLiteral(descriptor.children)
                : t.identifier('undefined')),
        ]);
        const tapCall = t.expressionStatement(t.callExpression(t.optionalMemberExpression(t.memberExpression(t.identifier('globalThis'), t.identifier('__scoutTap')), t.identifier('call'), false, true), [t.identifier('undefined'), descriptorObj, argsId]));
        const originalCall = t.returnStatement(t.logicalExpression('&&', originalExpr, t.callExpression(t.memberExpression(originalExpr, t.identifier('apply')), [
            t.thisExpression(),
            argsId,
        ])));
        const body = t.blockStatement([tapCall, originalCall]);
        const wrapped = t.arrowFunctionExpression([t.restElement(argsId)], body);
        return t.jsxExpressionContainer(wrapped);
    };
    return {
        name: '@base14/scout-react/babel-plugin',
        visitor: {
            JSXElement(path, state) {
                const opts = state.opts || {};
                const components = opts.components || DEFAULT_COMPONENTS;
                const handlers = opts.handlers || DEFAULT_HANDLERS;
                const fileName = (state.file && state.file.opts && state.file.opts.filename) || '';
                if (fileName.includes('node_modules'))
                    return;
                const openingElement = path.node.openingElement;
                if (!openingElement || !openingElement.name)
                    return;
                if (!t.isJSXIdentifier(openingElement.name))
                    return;
                const componentName = openingElement.name.name;
                if (!components.includes(componentName))
                    return;
                for (const attr of openingElement.attributes) {
                    if (!t.isJSXAttribute(attr))
                        continue;
                    if (!attr.name || typeof attr.name.name !== 'string')
                        continue;
                    if (!handlers.includes(attr.name.name))
                        continue;
                    if (!attr.value || !t.isJSXExpressionContainer(attr.value))
                        continue;
                    const inner = attr.value.expression;
                    if (!inner || t.isJSXEmptyExpression(inner))
                        continue;
                    if (inner[WRAPPED_MARKER])
                        continue;
                    const descriptor = {
                        componentName,
                        accessibilityLabel: getStringAttribute(openingElement, 'accessibilityLabel'),
                        testID: getStringAttribute(openingElement, 'testID'),
                        children: getStaticTextChild(path.node),
                    };
                    const wrapped = buildWrappedHandler(inner, descriptor);
                    wrapped.expression[WRAPPED_MARKER] = true;
                    attr.value = wrapped;
                }
            },
        },
    };
};
