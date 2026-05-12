export const getAvailableVariants = (subject, session) => {
    if (subject === 'IGCSE Additional Mathematics') {
        if (session === 'February/March') {
            return ['12', '22'];
        }
        return ['11', '12', '13', '21', '22', '23'];
    } else if (subject === 'A-level Mathematics') {
        if (session === 'February/March') {
            return ['12', '22', '32', '42', '52', '62'];
        }
        return [
            '11', '12', '13', '21', '22', '23',
            '31', '32', '33', '41', '42', '43',
            '51', '52', '53', '61', '62', '63'
        ];
    }
    // Default fallback
    return ['11', '12', '13', '21', '22', '23'];
};
