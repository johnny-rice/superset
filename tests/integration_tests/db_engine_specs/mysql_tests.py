# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
import unittest

from sqlalchemy.dialects import mysql
from sqlalchemy.dialects.mysql import DATE, NVARCHAR, TEXT, VARCHAR

from superset.db_engine_specs.mysql import MySQLEngineSpec
from superset.errors import ErrorLevel, SupersetError, SupersetErrorType
from tests.integration_tests.base_tests import SupersetTestCase


class TestMySQLEngineSpecsDbEngineSpec(SupersetTestCase):
    @unittest.skipUnless(
        SupersetTestCase.is_module_installed("MySQLdb"), "mysqlclient not installed"
    )
    def test_get_datatype_mysql(self):
        """Tests related to datatype mapping for MySQL"""
        assert "TINY" == MySQLEngineSpec.get_datatype(1)
        assert "VARCHAR" == MySQLEngineSpec.get_datatype(15)

    def test_column_datatype_to_string(self):
        test_cases = (
            (DATE(), "DATE"),
            (VARCHAR(length=255), "VARCHAR(255)"),
            (
                VARCHAR(length=255, charset="latin1", collation="utf8mb4_general_ci"),
                "VARCHAR(255)",
            ),
            (NVARCHAR(length=128), "NATIONAL VARCHAR(128)"),
            (TEXT(), "TEXT"),
        )

        for original, expected in test_cases:
            actual = MySQLEngineSpec.column_datatype_to_string(
                original, mysql.dialect()
            )
            assert actual == expected

    def test_extract_error_message(self):
        from MySQLdb._exceptions import OperationalError

        message = "Unknown table 'BIRTH_NAMES1' in information_schema"
        exception = OperationalError(message)
        extracted_message = MySQLEngineSpec._extract_error_message(exception)
        assert extracted_message == message

        exception = OperationalError(123, message)
        extracted_message = MySQLEngineSpec._extract_error_message(exception)
        assert extracted_message == message

    def test_extract_errors(self):
        """
        Test that custom error messages are extracted correctly.
        """
        msg = "mysql: Access denied for user 'test'@'testuser.com'"
        result = MySQLEngineSpec.extract_errors(Exception(msg))
        assert result == [
            SupersetError(
                error_type=SupersetErrorType.CONNECTION_ACCESS_DENIED_ERROR,
                message='Either the username "test" or the password is incorrect.',
                level=ErrorLevel.ERROR,
                extra={
                    "invalid": ["username", "password"],
                    "engine_name": "MySQL",
                    "issue_codes": [
                        {
                            "code": 1014,
                            "message": "Issue 1014 - Either the"
                            " username or the password is wrong.",
                        },
                        {
                            "code": 1015,
                            "message": "Issue 1015 - Either the database is "
                            "spelled incorrectly or does not exist.",
                        },
                    ],
                },
            )
        ]

        msg = "mysql: Unknown MySQL server host 'badhostname.com'"
        result = MySQLEngineSpec.extract_errors(Exception(msg))
        assert result == [
            SupersetError(
                error_type=SupersetErrorType.CONNECTION_INVALID_HOSTNAME_ERROR,
                message='Unknown MySQL server host "badhostname.com".',
                level=ErrorLevel.ERROR,
                extra={
                    "invalid": ["host"],
                    "engine_name": "MySQL",
                    "issue_codes": [
                        {
                            "code": 1007,
                            "message": "Issue 1007 - The hostname"
                            " provided can't be resolved.",
                        }
                    ],
                },
            )
        ]

        msg = "mysql: Can't connect to MySQL server on 'badconnection.com'"
        result = MySQLEngineSpec.extract_errors(Exception(msg))
        assert result == [
            SupersetError(
                error_type=SupersetErrorType.CONNECTION_HOST_DOWN_ERROR,
                message='The host "badconnection.com" might be '
                "down and can't be reached.",
                level=ErrorLevel.ERROR,
                extra={
                    "invalid": ["host", "port"],
                    "engine_name": "MySQL",
                    "issue_codes": [
                        {
                            "code": 1007,
                            "message": "Issue 1007 - The hostname provided"
                            " can't be resolved.",
                        }
                    ],
                },
            )
        ]

        msg = "mysql: Can't connect to MySQL server on '93.184.216.34'"
        result = MySQLEngineSpec.extract_errors(Exception(msg))
        assert result == [
            SupersetError(
                error_type=SupersetErrorType.CONNECTION_HOST_DOWN_ERROR,
                message='The host "93.184.216.34" might be down and can\'t be reached.',
                level=ErrorLevel.ERROR,
                extra={
                    "invalid": ["host", "port"],
                    "engine_name": "MySQL",
                    "issue_codes": [
                        {
                            "code": 10007,
                            "message": "Issue 1007 - The hostname provided "
                            "can't be resolved.",
                        }
                    ],
                },
            )
        ]

        msg = "mysql: Unknown database 'badDB'"
        result = MySQLEngineSpec.extract_errors(Exception(msg))
        assert result == [
            SupersetError(
                message='Unable to connect to database "badDB".',
                error_type=SupersetErrorType.CONNECTION_UNKNOWN_DATABASE_ERROR,
                level=ErrorLevel.ERROR,
                extra={
                    "invalid": ["database"],
                    "engine_name": "MySQL",
                    "issue_codes": [
                        {
                            "code": 1015,
                            "message": "Issue 1015 - Either the database is spelled incorrectly or does not exist.",  # noqa: E501
                        }
                    ],
                },
            )
        ]

        msg = "check the manual that corresponds to your MySQL server version for the right syntax to use near 'from_"  # noqa: E501
        result = MySQLEngineSpec.extract_errors(Exception(msg))
        assert result == [
            SupersetError(
                message='Please check your query for syntax errors near "from_". Then, try running your query again.',  # noqa: E501
                error_type=SupersetErrorType.SYNTAX_ERROR,
                level=ErrorLevel.ERROR,
                extra={
                    "engine_name": "MySQL",
                    "issue_codes": [
                        {
                            "code": 1030,
                            "message": "Issue 1030 - The query has a syntax error.",
                        }
                    ],
                },
            )
        ]
