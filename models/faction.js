const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(process.env.MYSQL_URI);

const Faction = sequelize.define('Faction', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    economy: {
        type: DataTypes.INTEGER,
        defaultValue: 100
    },
    money: {
        type: DataTypes.INTEGER,
        defaultValue: 1000
    },
    leader: {
        type: DataTypes.STRING
    },
    members: {
        type: DataTypes.JSON,
        defaultValue: []
    }
}, {
    tableName: 'factions',
    timestamps: false
});

module.exports = { Faction, sequelize };
